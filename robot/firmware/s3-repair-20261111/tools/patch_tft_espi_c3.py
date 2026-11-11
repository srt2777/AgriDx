# -*- coding: utf-8 -*-
"""
PlatformIO pre 脚本（只挂在 esp32-c3-devkitm-1-tft 环境上）：构建前修补 TFT_eSPI 的 C3 头文件。

问题（已用崩溃日志 + 固件反汇编 + addr2line 三方确认）：
  Arduino core 的 soc.h 定义  REG_SPI_BASE(i) (((i)==2) ? DR_REG_SPI2_BASE : 0)
  它要的是 SPI 外设编号（2 = SPI2），但 TFT_eSPI 的 C3 头文件传进来的是
  SPI_PORT = SPI2_HOST = 1，于是基址算成 0，_spi_user/_spi_mosi_dlen/_spi_w 全是
  “0 + 偏移”（0x10/0x1c/0x98）。tft.init() -> begin_tft_write() 一写
  *_spi_user = SPI_USR_MOSI 就写到地址 0x10，Store access fault，开机即崩。
  TFT_eSPI 自带的兜底（#ifndef REG_SPI_BASE ...）因为 core 先定义了宏而从不生效。

做法：在兜底 #ifndef 之前插入  #undef REG_SPI_BASE / #define REG_SPI_BASE(i) DR_REG_SPI2_BASE。
  - 幂等：已经打过补丁（有标记）就跳过；
  - 只改 .pio/libdeps/<env>/ 下的库副本，不碰 S3 / OLED 环境，也不改 core；
  - 配套：main.cpp 有 static_assert，补丁没生效时直接编译失败，不会烧出必崩的固件。
"""
import os
import re

try:
    Import("env")  # noqa: F821  PlatformIO/SCons 注入
except NameError:  # 脱离 PlatformIO 单独运行（自测）
    env = None

MARK = b"SIJIA-PATCH: REG_SPI_BASE"
PATCH = (
    b"// SIJIA-PATCH: REG_SPI_BASE (added by tools/patch_tft_espi_c3.py)\n"
    b"// Arduino core's REG_SPI_BASE(i) only accepts peripheral number 2, but SPI_PORT here is\n"
    b"// SPI2_HOST (=1) -> base 0 -> every SPI register pointer becomes NULL+offset -> crash.\n"
    b"#undef REG_SPI_BASE\n"
    b"#define REG_SPI_BASE(i) DR_REG_SPI2_BASE\n"
)
GUARD_RE = re.compile(rb"^[ \t]*#[ \t]*ifndef[ \t]+REG_SPI_BASE\b", re.M)
TAG = "[patch_tft_espi_c3]"


def find_header(root):
    if not os.path.isdir(root):
        return None
    for name in sorted(os.listdir(root)):
        if name.lower().startswith("tft_espi"):
            p = os.path.join(root, name, "Processors", "TFT_eSPI_ESP32_C3.h")
            if os.path.isfile(p):
                return p
    return None


def apply_patch(path):
    with open(path, "rb") as f:
        data = f.read()
    if MARK in data:
        print(TAG, "already patched:", path)
        return
    m = GUARD_RE.search(data)
    if m:
        new = data[: m.start()] + PATCH + data[m.start():]
        where = "before the '#ifndef REG_SPI_BASE' fallback"
    else:
        # 找不到兜底块（库结构变了）：追加到文件末尾，仍然能覆盖之后的所有展开
        new = data + (b"" if data.endswith(b"\n") else b"\n") + PATCH
        where = "at end of file (fallback block not found)"
    with open(path, "wb") as f:
        f.write(new)
    print(TAG, "patched", where + ":", path)


def run(libdeps_env_dir):
    path = find_header(libdeps_env_dir)
    if path:
        apply_patch(path)
    else:
        print(TAG, "WARNING: TFT_eSPI C3 header not found under", libdeps_env_dir,
              "- libraries may not be installed yet. Run the build once more; main.cpp has a "
              "static_assert, so an unpatched build fails instead of producing a crashing firmware.")


if env is not None:
    run(os.path.join(env.subst("$PROJECT_LIBDEPS_DIR"), env.subst("$PIOENV")))
