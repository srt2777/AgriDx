#!/usr/bin/env python3
"""Upload an app image over ArduinoOTA without waiting for an ACK per block."""
import argparse
import getpass
import hashlib
import importlib.util
import socket
import threading
import time
from pathlib import Path


def upload(tool: Path, device: str, host: str, image: Path, password: str) -> None:
    spec = importlib.util.spec_from_file_location("espota", tool)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load the Arduino-ESP32 espota.py tool")
    espota = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(espota)
    espota.TIMEOUT = 2
    size = image.stat().st_size
    with image.open("rb") as data:
        digest = hashlib.md5(data.read()).hexdigest()
    start = time.monotonic()
    with socket.socket() as listener:
        listener.bind((host, 0))
        listener.listen(1)
        listener.settimeout(12)
        port = listener.getsockname()[1]
        ok, challenge, error = espota.send_invitation_and_get_auth_challenge(
            device, 3232, f"{espota.FLASH} {port} {size} {digest}\n", local_addr=host,
        )
        if not ok or not challenge.startswith("AUTH ") or len(challenge.split()[-1]) != 64:
            raise RuntimeError(error or "Expected a SHA-256 OTA password challenge")
        ok, error = espota.authenticate(
            device, 3232, password, False, False, str(image), size, digest,
            challenge.split()[-1], local_addr=host,
        )
        if not ok:
            raise RuntimeError(error or "OTA authentication rejected")
        peer, address = listener.accept()
        with peer:
            if address[0] != device:
                raise RuntimeError("OTA callback came from a different address")
            peer.settimeout(15)
            confirmed = threading.Event()

            def read_result() -> None:
                tail = b""
                try:
                    while block := peer.recv(4096):
                        response = tail + block
                        if response.endswith(b"OK"):
                            confirmed.set()
                            return
                        tail = response[-1:]
                except OSError:
                    return

            reader = threading.Thread(target=read_result, daemon=True)
            reader.start()
            transfer_start = time.monotonic()
            with image.open("rb") as data:
                while chunk := data.read(64 * 1024):
                    peer.sendall(chunk)
            reader.join(timeout=20)
            if not confirmed.is_set():
                raise RuntimeError("Device did not confirm the image checksum")
    transfer = time.monotonic() - transfer_start
    print(f"Verified {size} bytes in {transfer:.2f} s ({size / 1024 / transfer:.1f} KiB/s), "
          f"{time.monotonic() - start:.2f} s including authentication")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--espota", type=Path, required=True, help="Arduino-ESP32 espota.py path")
    parser.add_argument("--device", required=True, help="ESP32 IPv4 address")
    parser.add_argument("--host", required=True, help="Computer IPv4 address on the same LAN")
    parser.add_argument("image", type=Path, help="ESP32-S3 application .bin")
    args = parser.parse_args()
    try:
        upload(args.espota, args.device, args.host, args.image, getpass.getpass("OTA password: "))
    except (OSError, RuntimeError) as error:
        parser.exit(1, f"OTA failed: {error}\n")


if __name__ == "__main__":
    main()
