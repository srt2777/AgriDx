# -*- coding: utf-8 -*-
"""
PlatformIO pre 脚本（挂在 esp32-s3-n16r8 环境）：构建前修补 TFT_eSPI 的 S3 头文件。

问题（与 C3 同源，已用崩溃日志确认）：
  Arduino core 的 soc.h 先定义了 REG_SPI_BASE(i)，TFT_eSPI 的 S3 头文件里
  #ifndef REG_SPI_BASE
    #define REG_SPI_BASE(i) (((i)>1) ? (DR_REG_SPI3_BASE) : (DR_REG_SPI2_BASE))
  这个兜底永远不会生效。core 的宏对 SPI_PORT（默认 FSPI=1）返回 0，
  于是 _spi_cmd/_spi_user/_spi_w 变成 0+偏移（0x10/0x1c/0x98），
  tft.init() -> begin_tft_write() 写 _spi_user 就 StoreProhibited
  （EXCVADDR=0x00000010，反复重启）。

做法：在兜底 #ifndef 之前插入
  #undef REG_SPI_BASE
  #define REG_SPI_BASE(i) (((i)>1) ? (DR_REG_SPI3_BASE) : (DR_REG_SPI2_BASE))
只改 .pio/libdeps/esp32-s3-n16r8/ 下的库副本，不碰 core，也不影响 C3 环境。
"""
import re

try:
    Import("env")  # noqa: F821  PlatformIO/SCons 注入
except NameError:
    env = None

MARK = b"SIJIA-PATCH-S3: REG_SPI_BASE"
PATCH = (
    b"// SIJIA-PATCH-S3: REG_SPI_BASE (added by tools/patch_tft_espi_s3.py)\n"
    b"// Arduino core's REG_SPI_BASE(i) is defined before this file, so the fallback below\n"
    b"// never applies; core returns 0 for FSPI(1) -> SPI register pointers = NULL+offset -> crash.\n"
    b"#undef REG_SPI_BASE\n"
    b"#define REG_SPI_BASE(i) (((i)>1) ? (DR_REG_SPI3_BASE) : (DR_REG_SPI2_BASE))\n"
)
GUARD_RE = re.compile(rb"^[ \t]*#[ \t]*ifndef[ \t]+REG_SPI_BASE\b", re.M)
TAG = "[patch_tft_espi_s3]"


def find_header(root):
    import os
    if not os.path.isdir(root):
        return None
    for name in sorted(os.listdir(root)):
        if name.lower().startswith("tft_espi"):
            p = os.path.join(root, name, "Processors", "TFT_eSPI_ESP32_S3.h")
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
    if not m:
        raise RuntimeError(TAG + ": 没找到 REG_SPI_BASE 兜底块，TFT_eSPI 结构可能变了: " + path)
    new = data[: m.start()] + PATCH + data[m.start():]
    with open(path, "wb") as f:
        f.write(new)
    print(TAG, "patched:", path)


def main():
    if env is None:
        return
    from platformio.builder.tools.piolib import PackageItem  # noqa: F401  (仅保证依赖存在)
    libdeps = env.subst("$PROJECT_LIBDEPS_DIR") + "/" + env.subst("$PIOENV")
    header = find_header(libdeps)
    if not header:
        # 首次构建库还没下载：给出明确提示，而不是静默跳过
        raise RuntimeError(TAG + ": TFT_eSPI 未安装（%s），先跑一次 pio run 让它下载" % libdeps)
    apply_patch(header)


main()
