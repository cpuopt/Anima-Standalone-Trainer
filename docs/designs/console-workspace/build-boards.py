from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import base64
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'design-demos'
SHOTS=ROOT/'screenshots/round-2'
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',21)
small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',16)
titles=['A 横向仪表带','B 窄栏诊断','C 日志专注']
descriptions=['硬件横排；日志全宽；显存明细在下方。','左栏收窄；模型位置与关键节点利用下方。','日志占主区；资源常驻底栏，明细按需打开。']
def data(p):return 'data:image/png;base64,'+base64.b64encode(p.read_bytes()).decode()
board=Image.new('RGB',(1440,396),'#edf1f6');draw=ImageDraw.Draw(board)
for i in range(3):
    x=480*i
    draw.text((x+12,10),titles[i],font=font,fill='#24334a')
    im=Image.open(SHOTS/f'dir-{i+1}-desktop.png');im.thumbnail((476,298));board.paste(im,(x+2,49))
    draw.text((x+12,358),descriptions[i],font=small,fill='#52657b')
board.save(ROOT/'comparison.png')
polish=Image.new('RGB',(1440,1460),'#edf1f6');draw=ImageDraw.Draw(polish)
for i in range(3):
    y=i*486
    draw.text((14,y+7),titles[i]+' / 第一轮',font=font,fill='#24334a')
    draw.text((734,y+7),'打磨后',font=font,fill='#24334a')
    for col,round in enumerate(['round-1','round-2']):
        im=Image.open(ROOT/f'screenshots/{round}/dir-{i+1}-desktop.png');im.thumbnail((712,445));polish.paste(im,(col*720+4,y+38))
polish.save(ROOT/'polish-before-after.jpg',quality=88)

demo_rows=['11:24:06  INFO   train.before_epoch · CUDA snapshot updated','11:24:07  INFO   steps 398/1000 · loss 0.0894','11:24:08  INFO   steps 399/1000 · loss 0.0892','11:24:29  INFO   Saving checkpoint','11:24:30  INFO   Checkpoint saved','11:24:31  WARN   Placement snapshot waiting for update']
tiny_log='<div class="tiny-log">'+''.join('<p>'+row+'</p>' for row in demo_rows*2)+'</div>'
resource='<div class="tiny-resource"><b>GPU 0</b><span>16.8 / 24 GB</span><div class="tiny-meter"><i></i></div><span>CPU 22%　RAM 26.4 / 64 GB</span></div>'
table='<table><tr><th>模型</th><th>设备</th><th>估算</th></tr>'+''.join(f'<tr><td>{name}</td><td>{device}</td><td>{size}</td></tr>' for name,device,size in [('DiT','cuda:0','3.9 GB'),('Qwen3','cpu','1.1 GB'),('VAE','cpu','0.3 GB'),('优化器','cuda:0','4.3 GB')])+'</table>'
thumb_css='''*{box-sizing:border-box}body{margin:0;padding:20px;background:#edf1f6;color:#24334a;font:14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}h1{font-size:23px;margin:0 0 6px}body>p{color:#52657b;margin:0 0 18px}.board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;max-width:1500px}.candidate{background:white;border:1px solid #d3dce7;border-radius:6px;overflow:hidden}.candidate h2{font-size:16px;margin:10px 12px 5px}.candidate>p{font-size:12px;color:#52657b;margin:0 12px 10px}.mini{height:300px;overflow:hidden;background:#10151f}.mini>img{width:100%;height:100%;object-fit:cover}.tag{display:block;padding:6px 12px;font-size:12px;color:#52657b}.tiny-head{height:30px;padding:6px 10px;background:#1d293b;color:#d5e1f2;font-size:12px;display:flex;justify-content:space-between}.tiny-log{padding:5px 10px;background:#0c121c;color:#c8d5e7;font:12px/1.8 Consolas,monospace;overflow:hidden;min-width:0}.tiny-log p{white-space:nowrap;margin:0}.tiny-log p:nth-child(6){color:#e8bd77}.tiny-resource{padding:9px 10px;display:flex;gap:8px;align-items:center;background:#1a2535;color:#d5e1f2;font-size:12px}.tiny-meter{height:5px;background:#35445b;width:70px}.tiny-meter i{display:block;width:70%;height:100%;background:#86aafa}.split{display:grid;grid-template-rows:145px 125px;gap:4px}.diagnosis{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#e7edf5;padding:8px}.diagnosis .tiny-resource{display:block;background:white;color:#24334a;border:1px solid #c6d2e2}.diagnosis span{display:block;margin-top:6px}.diagnosis table{color:#24334a}.mini table{width:100%;border-collapse:collapse;font-size:12px}.mini th,.mini td{text-align:left;padding:4px;border-bottom:1px solid #a6b5c9}.candy{background:#e8f1f7}.candy .tiny-head{background:#fff;color:#263c51}.candy .tiny-resource{background:#fff;color:#263c51;border-bottom:2px solid #c2d3e0;margin:6px;border-radius:8px}.candy .tiny-head b{background:#d9f1df;border-bottom:2px solid #69a77d;padding:0 8px;color:#24613a;border-radius:5px}.candy .tiny-log{margin:6px;border:1px solid #bdcadb;border-radius:5px;height:200px}.map-grid{display:grid;grid-template-columns:190px minmax(0,1fr);height:270px;background:#191b1c}.map-grid svg{width:190px;height:235px}.map-grid .tiny-log{border-left:1px solid #4a4f52}@media(max-width:950px){.board{grid-template-columns:1fr}.mini{height:auto;aspect-ratio:1.6}}'''
cards=[]
for i in range(3):cards.append(f'<section class="candidate" data-thumb="{i+1}"><h2>{titles[i]}</h2><p>{descriptions[i]}</p><div class="mini"><img src="{data(SHOTS/f"dir-{i+1}-desktop.png")}" alt="{titles[i]}完整界面"></div><small class="tag">完整版 / 可操作演示状态与日志</small></section>')
alternates=[
 ('D 上下双工作区','日志在上，GPU与模型位置在下。','<div class="tiny-head"><b>控制台</b><span>CPU 22%　GPU 82%</span></div><div class="split">'+tiny_log+'<div class="diagnosis">'+resource+table+'</div></div>'),
 ('E 触感状态台','强化状态按下感，紧凑切换资源与日志。','<div class="candy"><div class="tiny-head"><b>正在训练</b><span>日志　资源　显存明细</span></div>'+resource+tiny_log+'</div>'),
 ('F 分层资源图','通过模型设备关系图定位卸载位置。','<div class="tiny-head"><b>控制台 / 资源关系</b><span>日志跟随中</span></div><div class="map-grid"><svg viewBox="0 0 190 235" role="img" aria-label="模型设备映射"><circle cx="95" cy="99" r="75" fill="none" stroke="#bca569" stroke-width="2"/><circle cx="95" cy="99" r="48" fill="none" stroke="#6f91ac"/><path d="M95 25v28M44 151l24-25m78 25-25-25" fill="none" stroke="#bca569"/><text x="95" y="94" fill="#e1d7ba" font-size="14" text-anchor="middle">GPU 0</text><text x="95" y="113" fill="#9eafbc" font-size="12" text-anchor="middle">DiT / LoRA</text><text x="95" y="22" fill="#e1d7ba" font-size="12" text-anchor="middle">CPU / Qwen3</text><text x="95" y="192" fill="#d5dbe1" font-size="12" text-anchor="middle">VAE → CPU</text><text x="95" y="215" fill="#9eafbc" font-size="12" text-anchor="middle">当前节点映射</text></svg>'+tiny_log+'</div>')]
for i,(title,desc,body)in enumerate(alternates):cards.append(f'<section class="candidate" data-thumb="{i+4}"><h2>{title}</h2><p>{desc}</p><div class="mini">{body}</div><small class="tag">备选方向 / 选择后展开</small></section>')
thumbs=f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>控制台六方向探索</title><style>{thumb_css}</style><h1>控制台 / 六个候选</h1><p>同一组演示数据，六种空间策略。前三版已做成完整交互原型。</p><div class="board">'+''.join(cards)+'</div></html>'
(OUT/'thumbs.html').write_text(thumbs,encoding='utf-8')

hub_css='''*{box-sizing:border-box}body{margin:0;padding:28px;background:#edf1f6;color:#24334a;font:14px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1500px;margin:auto}h1{font-size:25px;margin:0 0 8px}p{margin:0 0 16px;color:#52657b}a{color:#245ebc;text-underline-offset:3px}.callout{padding:14px 18px;background:white;border-left:3px solid #326cd4;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}article{background:white;border:1px solid #d3dce7;border-radius:7px;padding:15px;min-width:0}h2{font-size:18px;margin:0 0 6px}h3{font-size:13px;color:#52657b;font-weight:500;margin:18px 0 7px}.cta{display:inline-block;background:#24334a;color:white;text-decoration:none;padding:8px 13px;border-radius:5px;margin:0 0 9px}.preview{width:100%;display:block;border:1px solid #d3dce7;border-radius:4px}.phone{height:360px;display:block;width:auto;max-width:100%;object-fit:contain;margin:auto}.foot{margin-top:24px}article ul{padding-left:20px;color:#52657b;font-size:13px;margin:0 0 14px}@media(max-width:1000px){.grid{grid-template-columns:1fr}body{padding:16px}}'''
reasons=[['左侧空白并入全宽日志区域','显存明细可收起，临时增加日志高度','硬件与日志同时可见，适合日常监控'],['左栏缩至330px，而不是占去近半屏','下方放模型设备表与日志关键节点','日志获得剩余宽度，保持熟悉的左右结构'],['没有常驻监控大列，日志优先','底栏持续显示CPU、RAM和GPU','点击打开资源诊断，不打断日志上下文']]
sections=[]
for i in range(3):
    n=i+1
    extra=f'<h3>打开诊断抽屉</h3><img class="preview" src="{data(SHOTS/f"dir-{n}-drawer.png")}" alt="诊断抽屉">' if n==3 else ''
    sections.append(f'<article><h2>{titles[i]}</h2><p>{descriptions[i]}</p><ul>'+''.join(f'<li>{x}</li>' for x in reasons[i])+f'</ul><a class="cta" href="dir-{n}.html">打开可交互原型</a><h3>桌面</h3><img class="preview" src="{data(SHOTS/f"dir-{n}-desktop.png")}" alt="桌面控制台"><h3>双GPU</h3><img class="preview" src="{data(SHOTS/f"dir-{n}-two-gpus.png")}" alt="双卡控制台"><h3>没有显存快照</h3><img class="preview" src="{data(SHOTS/f"dir-{n}-no-snapshot.png")}" alt="没有节点快照时">'+extra+f'<h3>手机竖屏</h3><img class="phone" src="{data(SHOTS/f"dir-{n}-phone.png")}" alt="手机竖屏"><h3>手机横屏</h3><img class="preview" src="{data(SHOTS/f"dir-{n}-landscape.png")}" alt="手机横屏"></article>')
hub=f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>控制台 / 三方向原型</title><style>{hub_css}</style><main><h1>把空间留给正在发生的事。</h1><p>针对控制台左下方空白，比较三种空间分配方式。沿用本项目已有字段，演示数据与真实运行状态无关。</p><div class="callout">建议优先体验 <b>A 横向仪表带</b>：硬件移至顶部，原先的左侧空白成为日志宽度。<br>希望保留左右布局可选B；以读日志为主可选C。全部支持搜索、级别筛选、自动跟随、换行和单/双卡演示。生产页面尚未改动。</div><div class="grid">'+''.join(sections)+'</div><p class="foot"><a href="thumbs.html">查看全部六个候选</a>　|　<a href="../polish-before-after.jpg">查看第一轮与打磨后对照</a><br>可混搭结构与配色；先选择方向，再继续细化。</p></main></html>'
(OUT/'index.html').write_text(hub,encoding='utf-8')
print('Built six-direction board, three-direction hub, and polish comparison.')
