from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import base64
import json
import re

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'design-demos'
SHOTS=ROOT/'screenshots/round-2'
font_path='C:/Windows/Fonts/msyh.ttc'
font=ImageFont.truetype(font_path,20)
small=ImageFont.truetype(font_path,16)
titles=['A 原比例密铺','B 紧凑联系表','C 轮次对照矩阵']
descriptions=['按 Prompt 分列，横竖图保持完整比例。','连续等格预览，一屏容纳更多图片。','轮次为行、Prompt 为列，适合训练对照。']
def data(path):
    suffix='png' if path.suffix=='.png' else 'jpeg'
    return f'data:image/{suffix};base64,'+base64.b64encode(path.read_bytes()).decode()

comparison=Image.new('RGB',(1440,700),'#eff2f7')
d=ImageDraw.Draw(comparison)
for i in range(3):
    x=i*480
    d.text((x+14,10),titles[i],font=font,fill='#263143')
    d.text((x+14,41),descriptions[i],font=small,fill='#586579')
    im=Image.open(SHOTS/f'dir-{i+1}-gallery.png');im.thumbnail((476,298));comparison.paste(im,(x+2,76))
    detail=Image.open(SHOTS/f'dir-{i+1}-detail-landscape-image.png');detail.thumbnail((476,298));comparison.paste(detail,(x+2,390))
comparison.save(ROOT/'comparison.png')

# First/last screenshots stay side by side as an honest polish record.
polish=Image.new('RGB',(1440,3*486),'#eff2f7');d=ImageDraw.Draw(polish)
for i in range(3):
    y=i*486;d.text((14,y+8),titles[i]+' / 第一轮',font=font,fill='#263143');d.text((734,y+8),'打磨后',font=font,fill='#263143')
    for j,round in enumerate(['round-1','round-2']):
        im=Image.open(ROOT/f'screenshots/{round}/dir-{i+1}-gallery.png');im.thumbnail((712,445));polish.paste(im,(j*720+4,y+38))
polish.save(ROOT/'polish-before-after.jpg',quality=88)

html=(OUT/'dir-1.html').read_text('utf-8')
assets=json.loads(re.search(r'const ASSETS=(.*?);\nconst MODE=',html,re.S).group(1))
safe=Image.new('RGB',(800,340),'#20242c')
for i,a in enumerate(assets):
    import io
    im=Image.open(io.BytesIO(base64.b64decode(a['src'].split(',')[1])));im.thumbnail((194,320));safe.paste(im,(i*200+(200-im.width)//2,8))
safe.save(ROOT/'source-contact.jpg',quality=86)

# Six actual miniature layouts: three selected, three alternate structures.
thumb_css='''*{box-sizing:border-box}body{margin:0;background:#e9edf3;color:#263143;font:14px "Segoe UI","Microsoft YaHei",sans-serif;padding:20px}h1{font-size:22px;margin:0 0 8px}p{color:#586579;margin:0 0 18px}.board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;max-width:1500px}.thumb{border:1px solid #cdd5e0;background:white;border-radius:6px;overflow:hidden}.thumb h2{font-size:16px;margin:0;padding:12px}.thumb>p{font-size:12px;padding:0 12px;margin-bottom:12px}.mini{height:300px;overflow:hidden;background:#151b26}.mini>img{width:100%;height:100%;object-fit:cover}.micro-head{height:28px;padding:7px 10px;color:#c7d1df;font-size:12px;background:#1c2432;display:flex;justify-content:space-between}.flow{columns:5;column-gap:3px;padding:4px}.flow img{width:100%;display:block;margin-bottom:3px}.bw{background:#0d0d0d}.wall{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;padding:3px}.wall img{width:100%;height:86px;object-fit:cover;filter:saturate(.8)}.chapter{background:#e7e4d8;color:#333}.chapter .micro-head{background:#d6d1bf;color:#333}.chapter-row{display:flex;gap:3px;border-bottom:1px solid #bcb7a9;padding:4px;height:87px}.chapter-row span{width:35px;font-size:12px;padding-top:28px}.chapter-row img{width:68px;min-width:0;object-fit:contain}.tag{display:block;font-size:12px;color:#586579;padding:0 12px 10px}@media(max-width:900px){.board{grid-template-columns:1fr}.mini{height:auto;aspect-ratio:1.6}}'''
cards=[]
for i in range(3):
    cards.append(f'<section class="thumb" data-thumb="{i+1}"><h2>{titles[i]}</h2><p>{descriptions[i]}</p><div class="mini"><img src="{data(SHOTS/f"dir-{i+1}-gallery.png")}" alt="{titles[i]}完整界面"></div><small class="tag">完整版 · 可点击 · 可缩放</small></section>')
images=[a['src'] for a in assets]
for idx,(title,desc,klass,layout) in enumerate([
    ('D 图像优先单流','全宽原比例流，分组交给过滤器。','', '<div class="flow">'+''.join(f'<img alt="本地样例" src="{images[i%4]}">' for i in range(20))+'</div>'),
    ('E 黑白索引墙','极窄工具栏，单色选择标识。','bw','<div class="wall">'+''.join(f'<img alt="本地样例" src="{images[i%4]}">' for i in range(18))+'</div>'),
    ('F 细线分册','轮次横向分节，一节连续一排。','chapter',''.join('<div class="chapter-row"><span>E0'+str(k+1)+'</span>'+''.join(f'<img alt="本地样例" src="{images[i%4]}">' for i in range(6))+'</div>' for k in range(3)))
]):
    cards.append(f'<section class="thumb" data-thumb="{idx+4}"><h2>{title}</h2><p>{desc}</p><div class="mini {klass}"><div class="micro-head"><span>ANIMA / 样例</span><span>全部　筛选　尺寸</span></div>{layout}</div><small class="tag">备选骨架 · 可选后展开</small></section>')
(OUT/'thumbs.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>六方向缩略探索</title><style>'+thumb_css+'</style><h1>样例页 / 六个候选</h1><p>相同本地样例，不同浏览结构。A、B、C 已制作完整交互版，D、E、F 保留为备选。</p><div class="board">'+''.join(cards)+'</div></html>',encoding='utf-8')

hub_css='''*{box-sizing:border-box}body{margin:0;padding:28px;background:#eef1f6;color:#263143;font:14px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1500px;margin:auto}h1{font-size:26px;margin:0 0 8px}p{margin:0 0 18px;color:#586579}a{color:#255ebc;text-underline-offset:3px}a.cta{display:inline-block;background:#263143;color:white;padding:8px 14px;border-radius:5px;text-decoration:none;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}article{min-width:0;background:white;border:1px solid #d4dce5;border-radius:8px;overflow:hidden;padding:16px}h2{font-size:18px;margin:0 0 6px}h3{font-size:13px;font-weight:500;color:#586579;margin:18px 0 7px}article img{width:100%;display:block;border:1px solid #d4dce5;border-radius:4px}.phone-row{display:flex;gap:8px;height:300px;justify-content:center;background:#f5f7fa;padding:8px;border-radius:5px}.phone-row img{height:100%;width:auto;max-width:48%;object-fit:contain;border:0}.callout{padding:14px 18px;border-left:3px solid #326cd4;background:white;margin:18px 0}.foot{margin-top:24px}@media(max-width:1000px){.grid{grid-template-columns:1fr}body{padding:16px}.phone-row{height:420px}}'''
sections=[]
for i in range(3):
    n=i+1
    sections.append(f'''<article><h2>{titles[i]}</h2><p>{descriptions[i]}</p><a class="cta" href="dir-{n}.html">打开可交互原型</a><h3>图库</h3><img src="{data(SHOTS/f'dir-{n}-gallery.png')}" alt="桌面图库"><h3>横图详情</h3><img src="{data(SHOTS/f'dir-{n}-detail-landscape-image.png')}" alt="横图详情"><h3>竖图详情</h3><img src="{data(SHOTS/f'dir-{n}-detail-portrait-image.png')}" alt="竖图详情"><h3>手机竖屏 / 图库与详情</h3><div class="phone-row"><img src="{data(SHOTS/f'dir-{n}-phone-gallery.png')}" alt="手机图库"><img src="{data(SHOTS/f'dir-{n}-phone-portrait-image.png')}" alt="手机竖图详情"></div><h3>手机横屏 / 横图详情</h3><img src="{data(SHOTS/f'dir-{n}-landscape-landscape-image.png')}" alt="手机横屏详情"></article>''')
hub=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>样例页 · 三方向交互原型</title><style>{hub_css}</style><main><h1>样例页，先把图片放在前面。</h1><p>三种浏览结构，均可打开体验。真实本地图片，36条演示记录；未连接生成、删除或真实元数据接口。</p><div class="callout">建议先体验 <b>B 紧凑联系表</b>：优先满足一屏多图。若更重视横竖图完整构图，选 A；若更重视训练轮次对照，选 C。<br>共通交互：滚轮围绕指针缩放、拖动平移、双击适应、1:1、参数独立滚动、横竖屏布局切换。</div><div class="grid">{''.join(sections)}</div><p class="foot"><a href="thumbs.html">查看全部六个候选（含 D / E / F 备选）</a>　|　<a href="../polish-before-after.jpg">第一轮与打磨后对照</a><br>选定方向后再细化。可混搭图库和详情，例如 B 的图库 + A 的右侧参数。</p></main></html>'''
(OUT/'index.html').write_text(hub,encoding='utf-8')
print('Built comparison, six-candidate board, and review hub.')
