from PIL import Image, ImageOps, ImageDraw, ImageFont
from pathlib import Path
root=Path(__file__).resolve().parent
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',22)
board=Image.new('RGB',(1680,465),'#10151f')
for i,title in enumerate(['A  侧栏工作台（推荐）','B  全宽画布','C  折叠辅助栏']):
    shot=Image.open(root/f'screenshots/dir-{i+1}.png').convert('RGB')
    shot=ImageOps.contain(shot,(544,410))
    board.paste(shot,(i*560+8,48))
    ImageDraw.Draw(board).text((i*560+12,10),title,font=font,fill='#e0e7f2')
board.save(root/'primary-directions.jpg',quality=94)
before=Image.open(root/'screenshots/dir-1-before.png').convert('RGB')
after=Image.open(root/'screenshots/dir-1.png').convert('RGB')
pair=Image.new('RGB',(1200,555),'#10151f')
for idx,(im,label) in enumerate([(before,'A 初稿'),(after,'A 打磨后')]):
    pair.paste(ImageOps.contain(im,(590,505)),(idx*600+5,40))
    ImageDraw.Draw(pair).text((idx*600+10,7),label,font=font,fill='#e0e7f2')
pair.save(root/'polish-before-after.jpg',quality=92)
