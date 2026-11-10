#!/usr/bin/env python3
"""生成司稼小机器人 RV0.1.0 中文字库子集（lv_font_conv）。
源字体：系统 Noto Sans CJK SC（Regular，免费），从 TTC 里取 SC 分面。
输出：src/fonts/font_zh_16.c（全文集）、font_zh_22.c / font_zh_12.c（UI 串集）。
"""
import subprocess, sys
from pathlib import Path
from fontTools.ttLib import TTCollection

TTC = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
OTF = "/tmp/NotoSansCJKsc-Regular.otf"
# 输出目录按脚本位置算（不要写死绝对路径；旧的写死路径指向已不存在的工作区）。
OUTDIR = str(Path(__file__).resolve().parent.parent / "src" / "fonts")

# 1) 取 SC 分面（TTC 里第 2 个）
c = TTCollection(TTC)
f = c.fonts[2]
f.save(OTF)
print("extracted SC face ->", OTF)

# 2) 字符集
UI = (
"司稼智能运维拖拉机正式站今天想问什么点一个问题直接问左右滑动切换对话监控"
"发动机启动困难水温高怎么办变速箱异响保养周期拖拉机发动机启动困难怎么办"
"拖拉机水温高怎么办拖拉机变速箱异响怎么办拖拉机保养周期怎么定"
"我是司稼拖拉机智能运维智能体点下面的预设问题或者从首页选一个问题问我"
"正在诊断描述故障现象新对话查看依据与核对项展开收起共条依据本地资料离线"
"在线服务器不通连接中暂无告警全部正常模拟数据水温趋势近分钟报警场景正常运行"
"冷却液温度爬升电池压差扩大定位漂移液压提升缓慢机油压力转速尚未更新更新于刚刚"
"分钟前显示上次数据请求失败请检查网络后重试正在诊断请稍等未联网请检查"
"输入法在语音版提供当前用预设问题提问已开始新对话问答失败请重试"
"拖拉机智能运维智能体正式站"
"待机中点一下唤醒"  # TFT 待机屏文案（2026-11-10 新增；待/唤/醒此前三档字库都没有）
)
COMMON = (
"的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十"
"三之进着等部度家电力里如水化高自二理起小物现量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间"
"样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员"
"革位入常文总次品式活设及管特件长求老头基资边流路级少图山系统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取"
"据处队南给色光门即保治北造百规热领七海口东导器压志世金增争观约内尔传号该步完深适查技研养论查修检换清润磨损温度过高过低启动无法正常异常"
"液压提升响应前桥后桥油箱油量燃油滤清空气排气进气气缸活塞曲轴凸轮离合踏板档位轮胎轮毂轴承齿轮链条皮带水泵风扇散热器节温器传感器仪表显示"
"报警注意模拟数据仿真监测实时上传反馈检测振动噪声频率信号电流电阻电路开关插头线路接地短路断路熔断蓄电池充电发电机调节器马达起动喷油"
"泵油滤芯机油柴油汽油润滑油冷却液防冻液可能原因建议首先其次然后如果但是因为所以需要避免禁止应当可以应该必须不要先拆下装上紧固松动"
"漏油渗漏裂纹变形烧蚀积碳堵塞老化腐蚀断裂脱落异物进入导致引起造成影响降低提高增加减少保持恢复检查测量判断确认排除解决方法步骤操作使"
"用按照进行完成之后之前同时另外此外尤其特别一般通常大概也许假如一旦遇到发现出现听到看到闻到感觉"
"零一二三四五六七八九十百千万亿第几左右上下前后多少大小长短高低快慢轻重厚薄粗细冷热干湿新旧好坏对错是否"
"春夏秋冬东南西北左右中内外前后上下年月日时分秒今天明天昨天早上晚上上午下午白天黑夜现在当时以后以前"
"东西南北上下左右前后里外中间旁边附近周围对面上面下面左边右边前面后面中间"
"红黄蓝绿青紫黑白灰金银铜铁钢铝"
)
SYMBOLS = "℃°±×÷≈λΔμ…—·（）、，。：；“”‘’《》℃→←↑↓√"

all_chars = sorted(set(UI + COMMON + SYMBOLS))
ui_chars = sorted(set(UI + SYMBOLS))
print("full set chars:", len(all_chars), "ui set chars:", len(ui_chars))

def run(size, chars, name):
    out = f"{OUTDIR}/{name}.c"
    cmd = ["npx", "--yes", "lv_font_conv",
           "--font", OTF, "--size", str(size), "--format", "lvgl", "--bpp", "4",
           "--output", out, "--symbols", chars, "--range", "0x20-0x7E",
           "--lv-font-name", name, "--no-kerning"]
    print("running:", " ".join(cmd[:8]), "...")
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-500:] if r.stdout else "")
    if r.returncode != 0:
        print(r.stderr[-2000:], file=sys.stderr)
        sys.exit(1)
    # lv_font_conv 生成的 #include "lvgl/lvgl.h" 在 PlatformIO 下找不到
    # （库根目录已在包含路径上，头文件就是 lvgl.h），改掉再交付。
    src = open(out).read().replace('#include "lvgl/lvgl.h"', '#include "lvgl.h"')
    open(out, "w").write(src)
    print("wrote", out)

run(16, "".join(all_chars), "font_zh_16")
run(22, "".join(ui_chars), "font_zh_22")
run(12, "".join(ui_chars), "font_zh_12")
print("done")
