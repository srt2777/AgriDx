# 中文字库与复现

三个字库均来自 Noto Sans CJK SC Regular 2.004（Copyright © 2014–2021 Adobe），使用 SIL Open Font License 1.1；许可全文见 `OFL-NotoSansCJK.txt`。

- [官方源字体](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)
- 上游固定提交：`f8d157532fbfaeda587e826d4cd5b21a49186f7c`
- 源 OTF 的 SHA-256：`2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。
- 源 OTF 的 Git blob SHA-1：`dc15562470b4f842321894787a0d066879ccff8b`，生成脚本会验证。
- 转换器：`lv_font_conv@1.5.3`；4 bpp、未压缩位图、无字偶间距。

`font_zh_16` 覆盖 ASCII U+0020–007E、基本 CJK 统一汉字区 U+4E00–9FEF（20,976 字），以及界面需要的符号。动态问答内容应使用此字体。源字体 2.004 不含 U+9FF0–9FFF 的 16 个罕见汉字；本字库也不包含 CJK 扩展区及所有 emoji，不能称为完整 Unicode 字库。

`font_zh_12` 和 `font_zh_22` 包含 ASCII、`src/*.cpp` 当前字符串字面量中的中文及固定符号。修改界面文案后应重新生成。它们不适合任意服务器回复或动态引用正文。

下载上面的 OTF 后，在固件目录运行（需要 Node/npm、Python `fonttools` 和已安装的 PlatformIO LVGL 依赖）：

```sh
python3 tools/gen_fonts.py --font /path/to/NotoSansCJKsc-Regular.otf
python3 tools/check_fonts.py
# 只更新界面小字库时：
python3 tools/gen_fonts.py --font /path/to/NotoSansCJKsc-Regular.otf --sizes 12 22
```

生成工具根据固定源文件与当前 UI 字符串生成 C 数组；不读取 `secrets.h`。验证工具直接编译已安装 LVGL 的字体查找及 RLE 解码代码和正式字体数组，逐个检查非空字符有可见像素；关闭压缩的负对照必须逐个返回空 bitmap。主机验证使用内存、A8 行步长和缓存的主机适配函数，不能代替屏幕接线与实际显示验收。

当前字库已改为 `bitmap_format = 0` 的未压缩位图，减少解码开销。若使用 `--compress` 重新生成 RLE 字库，则必须保留 `LV_USE_FONT_COMPRESSED 1`。

**必须保留 `LV_FONT_FMT_TXT_LARGE 1`。** 16px 位图超过 1 MiB，需要 32 位位图索引；默认的小字体描述符只有 20 位索引。转换器生成的编译期保护和验证脚本都会拒绝未启用 LARGE 的配置。
