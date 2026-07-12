#!/usr/bin/env python3
# Analiza el CUERPO SOSTENIDO (tramo central) de cada crudo mp3.
# Saca: duracion, RMS medio, centroide espectral (Hz -> grave/media/aguda),
# estabilidad (coef.var del RMS por ventanas), pico espectral, y flags.
import subprocess, json, os, sys, wave, struct, math

RAW_DIR = os.path.expanduser('~/cAlgo/dronpilot/audio/sound2_raw')
CENTER_SEC = 2.5

def ffprobe_dur(path):
    try:
        out = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration',
                              '-of','default=nk=1:nw=1', path], capture_output=True, text=True)
        return float(out.stdout.strip())
    except Exception:
        return 0.0

def decode_center(path, dur):
    # tramo central de CENTER_SEC (o menos si el clip es corto), mono 22050, wav
    start = max(0.0, dur/2 - CENTER_SEC/2)
    seg = min(CENTER_SEC, max(0.5, dur-0.2))
    tmp = '/tmp/_bodyseg.wav'
    subprocess.run(['ffmpeg','-y','-v','error','-ss',f'{start:.3f}','-t',f'{seg:.3f}',
                    '-i',path,'-ac','1','-ar','22050','-f','wav',tmp], capture_output=True)
    return tmp

def read_wav(path):
    with wave.open(path,'rb') as w:
        n=w.getnframes(); sr=w.getframerate()
        raw=w.readframes(n)
    data=struct.unpack('<%dh'%(len(raw)//2), raw)
    return data, sr

def analyze(path):
    dur = ffprobe_dur(path)
    if dur <= 0.3:
        return {'error':'dur too short','dur':dur}
    seg = decode_center(path, dur)
    data, sr = read_wav(seg)
    if not data:
        return {'error':'no samples','dur':dur}
    N=len(data)
    # RMS global (normalizado a 1.0)
    rms = math.sqrt(sum(x*x for x in data)/N)/32768.0
    # estabilidad: RMS por ventanas de 50ms, coef var
    win=int(sr*0.05); rmss=[]
    for i in range(0,N-win,win):
        s=data[i:i+win]
        rmss.append(math.sqrt(sum(x*x for x in s)/len(s)))
    if len(rmss)>=2:
        mean=sum(rmss)/len(rmss)
        var=sum((r-mean)**2 for r in rmss)/len(rmss)
        cv=(math.sqrt(var)/mean) if mean>0 else 9
    else:
        cv=9
    # centroide espectral via DFT gruesa (downsample a bins)
    # usa una FFT simple sobre ventana Hann de 4096
    M=min(8192, N)
    # aplicar Hann
    import cmath
    # Para eficiencia usa numpy si existe
    try:
        import numpy as np
        arr=np.array(data,dtype=float)
        # centroide sobre todo el segmento con STFT promedio
        frame=2048; hop=1024
        cents=[]; peaks=[]; lowratio=[]
        wnd=np.hanning(frame)
        freqs=np.fft.rfftfreq(frame, 1.0/sr)
        for i in range(0,len(arr)-frame,hop):
            fr=arr[i:i+frame]*wnd
            mag=np.abs(np.fft.rfft(fr))
            if mag.sum()<1e-6: continue
            c=(freqs*mag).sum()/mag.sum()
            cents.append(c)
            peaks.append(freqs[np.argmax(mag)])
            # energia <300Hz vs total (grosor grave)
            lowratio.append(mag[freqs<300].sum()/mag.sum())
        centroid=float(np.median(cents)) if cents else 0
        peak=float(np.median(peaks)) if peaks else 0
        low=float(np.median(lowratio)) if lowratio else 0
        # energia alta >4kHz (whiny)
        hi=[]
        for i in range(0,len(arr)-frame,hop):
            fr=arr[i:i+frame]*wnd
            mag=np.abs(np.fft.rfft(fr))
            if mag.sum()<1e-6: continue
            hi.append(mag[freqs>4000].sum()/mag.sum())
        hiratio=float(np.median(hi)) if hi else 0
    except ImportError:
        centroid=peak=low=hiratio=-1
    band = 'grave' if centroid and centroid<1400 else ('media' if centroid and centroid<2600 else 'aguda')
    return {'dur':round(dur,2),'rms':round(rms,4),'stability_cv':round(cv,3),
            'centroid_hz':round(centroid),'peak_hz':round(peak),
            'low_ratio':round(low,3),'hi_ratio':round(hiratio,3),'band':band}

if __name__=='__main__':
    files=sorted([f for f in os.listdir(RAW_DIR) if f.endswith('.mp3')])
    res={}
    for f in files:
        p=os.path.join(RAW_DIR,f)
        try:
            res[f]=analyze(p)
        except Exception as e:
            res[f]={'error':str(e)}
        print(f"{f}: {json.dumps(res[f])}", flush=True)
    with open(os.path.join(RAW_DIR,'body_analysis.json'),'w') as fh:
        json.dump(res,fh,indent=2)
