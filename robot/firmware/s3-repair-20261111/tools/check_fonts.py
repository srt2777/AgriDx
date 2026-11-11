#!/usr/bin/env python3
"""Decode the shipped fonts with the installed LVGL C decoder on the host.

No board or serial port is used. Memory allocation, A8 stride and cache hooks
use host shims; glyph lookup, RLE decompression and the font data are real.
Both decoder configurations are tested: plain fonts must render with either;
compressed fonts must be rejected when compression support is disabled.
Requires a C compiler and the PlatformIO LVGL dependency (pio run installs it).
"""
from pathlib import Path
import argparse
import os
import re
import shlex
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--fonts-dir", type=Path, default=ROOT / "src/fonts")
parser.add_argument("--benchmark", action="store_true", help="Report host-only lookup/decode CPU time; not device frame rate")
parser.add_argument("--lvgl", type=Path, default=ROOT / ".pio/libdeps/esp32-s3-n16r8/lvgl")
args = parser.parse_args()
library = args.lvgl.resolve()
decoder = library / "src/font/fmt_txt/lv_font_fmt_txt.c"
if not decoder.exists():
    raise SystemExit(f"Installed LVGL 9.6 decoder not found: {decoder}")

config = (ROOT / "include/lv_conf.h").read_text()
if not re.search(r"^#define\s+LV_FONT_FMT_TXT_LARGE\s+1\b", config, re.M):
    raise SystemExit("Firmware must enable LV_FONT_FMT_TXT_LARGE: font_zh_16 exceeds the default 20-bit bitmap index")

fonts = sorted(args.fonts_dir.resolve().glob("font_zh_*.c"))
if {font.stem for font in fonts} != {"font_zh_12", "font_zh_16", "font_zh_22"}:
    raise SystemExit("Expected all three shipped font_zh_12/16/22 sources")
ui_codepoints = set()
tokens = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"')
for path in sorted((ROOT / "src").glob("*.cpp")):
    for token in tokens.findall(path.read_text()):
        if token.startswith('"'):
            ui_codepoints.update(ord(ch) for ch in token[1:-1] if ord(ch) > 126)
declarations = []
cases = []
for font in fonts:
    source = font.read_text()
    fmt = re.search(r"\.bitmap_format\s*=\s*([012])\b", source)
    if not fmt:
        raise SystemExit(f"Unsupported bitmap format: {font.name}")
    bitmap_format = int(fmt.group(1))
    if bitmap_format and not re.search(r"^#define\s+LV_USE_FONT_COMPRESSED\s+1\b", config, re.M):
        raise SystemExit("Compressed fonts require LV_USE_FONT_COMPRESSED 1 in firmware")
    codepoints = sorted(set(int(x, 16) for x in re.findall(r"/\* U\+([0-9A-Fa-f]+)", source)))
    if not codepoints or not any(cp > 0x4e00 for cp in codepoints):
        raise SystemExit(f"No Chinese glyphs found in {font.name}")
    name = font.stem
    required = ui_codepoints | (set(range(0x4e00, 0x9ff0)) if name == "font_zh_16" else set())
    missing = required - set(codepoints)
    if missing:
        raise SystemExit(f"{name} is missing {len(missing)} required characters: " + "".join(map(chr, sorted(missing)[:30])))
    declarations.append(f"LV_FONT_DECLARE({name});\nstatic const uint32_t cps_{name}[] = {{" + ",".join(map(str, codepoints)) + "};")
    cases.append(f'{{"{name}", &{name}, cps_{name}, sizeof(cps_{name}) / sizeof(cps_{name}[0]), {bitmap_format}}}')

harness = r'''
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "lvgl.h"
#include "src/core/lv_global.h"

/* Host-only hooks. The production font decoder itself is compiled unchanged. */
lv_global_t lv_global;
static size_t decoder_allocations;
void *lv_malloc(size_t n) { decoder_allocations++; void *p = malloc(n); if(!p) abort(); return p; }
void *lv_malloc_zeroed(size_t n) { void *p = calloc(1,n); if(!p) abort(); return p; }
void lv_free(void *p) { free(p); }
void *lv_memcpy(void *d, const void *s, size_t n) { return memcpy(d,s,n); }
void *lv_utils_bsearch(const void *k, const void *b, size_t n, size_t s,
                      int (*cmp)(const void *, const void *)) { return bsearch(k,b,n,s,cmp); }
uint32_t lv_draw_buf_width_to_stride(uint32_t w, lv_color_format_t cf) {
    if(cf != LV_COLOR_FORMAT_A8) abort();
    return (w + 3) & ~3u;
}
void lv_draw_buf_flush_cache(const lv_draw_buf_t *b, const lv_area_t *a) { (void)b; (void)a; }

DECLARATIONS
int main(void) {
    struct test_font { const char *name; const lv_font_t *font; const uint32_t *cps; size_t n; unsigned format; };
    const struct test_font fonts[] = {CASES};
    for(size_t f = 0; f < sizeof(fonts)/sizeof(fonts[0]); f++) {
        size_t drawn = 0, chinese = 0, ascii = 0, empty = 0;
        for(size_t c = 0; c < fonts[f].n; c++) {
            uint32_t cp = fonts[f].cps[c];
            lv_font_glyph_dsc_t gd = {0};
            if(!fonts[f].font->get_glyph_dsc(fonts[f].font, &gd, cp, 0)) {
                fprintf(stderr, "Missing glyph %s U+%04X\n", fonts[f].name, cp); return 1;
            }
            if(!gd.box_w || !gd.box_h) { empty++; continue; }
            gd.resolved_font = fonts[f].font;
            size_t bytes = lv_draw_buf_width_to_stride(gd.box_w, LV_COLOR_FORMAT_A8) * gd.box_h;
            uint8_t *pixels = calloc(1, bytes);
            lv_draw_buf_t buf = {.data_size = bytes, .data = pixels};
            const void *result = fonts[f].font->get_glyph_bitmap(&gd, &buf);
            size_t visible = 0;
            for(size_t p = 0; p < bytes; p++) if(pixels[p]) visible++;
            free(pixels);
            if(fonts[f].format == 0 || LV_USE_FONT_COMPRESSED) {
                if(result != &buf || visible == 0) {
                    fprintf(stderr, "Blank glyph %s U+%04X\n", fonts[f].name, cp); return 2;
                }
            } else if(result != NULL || visible != 0) {
                fprintf(stderr, "Compressed negative control unexpectedly decoded a glyph\n"); return 3;
            }
            drawn++;
            if(cp >= 0x4e00 && cp <= 0x9fff) chinese++;
            if(cp >= 0x21 && cp <= 0x7e) ascii++;
        }
        printf("compression=%d %s: %zu %s glyphs (%zu Chinese, %zu ASCII; %zu spacing glyphs)\n",
               LV_USE_FONT_COMPRESSED, fonts[f].name, drawn,
               (fonts[f].format == 0 || LV_USE_FONT_COMPRESSED) ? "nonblank" : "correctly rejected", chinese, ascii, empty);
#if LV_USE_FONT_COMPRESSED
        if(BENCH_LOOPS > 0) {
            uint8_t pixels[4096] = {0};
            lv_draw_buf_t buf = {.data_size = sizeof(pixels), .data = pixels};
            size_t calls = 0, before = decoder_allocations;
            volatile size_t checksum = 0;
            clock_t started = clock();
            for(size_t repeat = 0; repeat < BENCH_LOOPS; repeat++) {
                uint32_t cp = fonts[f].cps[repeat % fonts[f].n];
                lv_font_glyph_dsc_t gd = {0};
                if(!fonts[f].font->get_glyph_dsc(fonts[f].font, &gd, cp, 0)) return 4;
                if(!gd.box_w || !gd.box_h) continue;
                if(lv_draw_buf_width_to_stride(gd.box_w, LV_COLOR_FORMAT_A8) * gd.box_h > sizeof(pixels)) return 5;
                gd.resolved_font = fonts[f].font;
                if(fonts[f].font->get_glyph_bitmap(&gd, &buf) != &buf) return 6;
                checksum += pixels[0];
                calls++;
            }
            double elapsed = (double)(clock() - started) / CLOCKS_PER_SEC;
            printf("HOST BENCH %s format=%u: %.3f us/glyph, %zu calls, %.1f decoder allocations/glyph, checksum=%zu\n",
                   fonts[f].name, fonts[f].format, elapsed * 1e6 / calls, calls,
                   (double)(decoder_allocations - before) / calls, checksum);
        }
#endif
    }
    return 0;
}
'''.replace("DECLARATIONS", "\n".join(declarations)).replace("CASES", ",".join(cases)).replace("BENCH_LOOPS", "100000" if args.benchmark else "0")

with tempfile.TemporaryDirectory(prefix="agridx-font-smoke-") as tmp:
    build = Path(tmp)
    driver = build / "check.c"
    driver.write_text(harness)
    for enabled in (0, 1):
        host_config = re.sub(r"(^#define\s+LV_USE_FONT_COMPRESSED\s+)[01]\b", rf"\g<1>{enabled}", config, flags=re.M)
        (build / "lv_conf.h").write_text(host_config)
        binary = build / f"check-{enabled}"
        command = shlex.split(os.environ.get("CC", "cc")) + [
            "-std=c11", "-O2", "-Wno-cpp", "-DLV_CONF_INCLUDE_SIMPLE=", "-DLV_CONF_SUPPRESS_DEFINE_CHECK",
            "-I", str(build), "-I", str(library), "-I", str(library / "include"),
            str(driver), str(decoder), *map(str, fonts), "-o", str(binary),
        ]
        compiled = subprocess.run(command, capture_output=True, text=True)
        if compiled.returncode:
            raise SystemExit("Host font test compilation failed:\n" + compiled.stderr[-4000:])
        subprocess.run([str(binary)], check=True)
print("PASS: every glyph matches its bitmap format with compression support both off and on.")
