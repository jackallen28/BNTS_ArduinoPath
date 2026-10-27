#!/usr/bin/env python3
"""Pack the supplied video/GIF frames; no bin geometry is drawn or generated."""
from pathlib import Path
from PIL import Image, ImageChops, ImageSequence
import argparse, hashlib, json, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', nargs='?', type=Path, default=ROOT/'assets/source/bin-opening.mp4')
args = parser.parse_args()
source = args.source.resolve()
with tempfile.TemporaryDirectory(prefix='bin-source-frames-') as directory:
    folder = Path(directory)
    if source.suffix.lower() == '.gif':
        with Image.open(source) as gif:
            images, durations = [], []
            for frame in ImageSequence.Iterator(gif):
                images.append(frame.convert('RGB').copy())
                durations.append(max(10, frame.info.get('duration', 40)))
    else:
        info = json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=r_frame_rate','-of','json',str(source)]))
        numerator, denominator = map(int, info['streams'][0]['r_frame_rate'].split('/'))
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(source),str(folder/'%04d.png')],check=True)
        images = [Image.open(p).convert('RGB') for p in sorted(folder.glob('*.png'))]
        durations = [1000*denominator/numerator]*len(images)
    if not images: raise SystemExit('No source frames')
    # Crop the same union rectangle from every frame: the object never jumps.
    bounds = []
    for image in images:
        difference = ImageChops.difference(image, Image.new('RGB',image.size,image.getpixel((0,0))))
        bbox = difference.convert('L').point(lambda p:255 if p > 35 else 0).getbbox()
        if bbox: bounds.append(bbox)
    if not bounds: raise SystemExit('No visible model in source')
    size = images[0].size
    box = (max(0,min(b[0] for b in bounds)-32),max(0,min(b[1] for b in bounds)-32),
           min(size[0],max(b[2] for b in bounds)+32),min(size[1],max(b[3] for b in bounds)+32))
    width = 400
    height = round((box[3]-box[1])*width/(box[2]-box[0]))
    frames = [image.crop(box).resize((width,height),Image.Resampling.LANCZOS) for image in images]
    columns = 5
    atlas = Image.new('RGB',(columns*width,((len(frames)+columns-1)//columns)*height),'white')
    for i,frame in enumerate(frames): atlas.paste(frame,((i%columns)*width,(i//columns)*height))
    atlas.save(ROOT/'assets/bin-source-frames.webp',quality=82,method=6)
    data = {'image':'bin-source-frames.webp','width':width,'height':height,'columns':columns,
            'frameCount':len(frames),'durationsMs':durations,'openFrame':len(frames)-1,
            'source':'User-supplied '+source.suffix.lstrip('.').upper()+'; actual frames, not a redraw',
            'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'crop':box}
    (ROOT/'assets/bin-source-frames.json').write_text(json.dumps(data,indent=2)+'\n')
    frames[0].save(ROOT/'assets/bin-closed.png')
    frames[-1].save(ROOT/'assets/bin-open.png')
    # A preview from those same source pixels; open once, pause, reverse, pause.
    reverse = frames[-2:0:-1]
    preview = frames+reverse
    times = [round(t) for t in durations]
    times[-1] += 1000
    times = times + [round(t) for t in durations[-2:0:-1]]
    times[0] += 1000
    preview[0].save(ROOT/'assets/bin-source-cycle.gif',save_all=True,append_images=preview[1:],duration=times,loop=0,optimize=True)
    print(f'Packed {len(frames)} original frames ({width}x{height}); forward opening / reverse closing.')
