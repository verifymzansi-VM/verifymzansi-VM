"""Original 100 BPM, 18-second warm electronic groove, synthesized without samples."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 32000
seconds = 18
samples = [0.0] * (rate * seconds)
rng = random.Random(91)
beat = 0.6

def add(start, length, sound):
    first = int(start * rate)
    for i in range(int(length * rate)):
        pos = first + i
        if pos >= len(samples):
            break
        samples[pos] += sound(i / rate)

def hz(note):
    return 440 * 2 ** ((note - 69) / 12)

chords = [[52, 55, 59, 62, 66], [57, 60, 64, 67, 71], [55, 59, 62, 66, 69], [59, 62, 66, 69, 73], [52, 55, 59, 62, 66]]
for bar, chord in enumerate(chords):
    start = bar * 3.6
    for k, note in enumerate(chord):
        freq = hz(note)
        add(start + k * 0.022, 3.6, lambda t, freq=freq: 0.032 * (1 - math.exp(-t * 18)) * math.exp(-t * 1.1) * (math.sin(2 * math.pi * freq * t) + 0.23 * math.sin(2 * math.pi * freq * 2 * t)))
    add(start, 0.25, lambda t: 0.07 * rng.uniform(-1, 1) * math.exp(-t * 20))

for b in range(30):
    start = b * beat
    if b % 6 in (0, 2, 3, 5):
        add(start, 0.25, lambda t: 0.45 * math.exp(-t * 18) * math.sin(2 * math.pi * (45 * t + 3.5 * (1 - math.exp(-t * 35)))))
    if b % 2 == 1:
        add(start, 0.13, lambda t: 0.11 * rng.uniform(-1, 1) * math.exp(-t * 31))
        add(start + 0.02, 0.10, lambda t: 0.06 * rng.uniform(-1, 1) * math.exp(-t * 40))
    for off in (0, 0.5, 0.75):
        add(start + off * beat, 0.06, lambda t: 0.035 * rng.uniform(-1, 1) * math.exp(-t * 75))
    freq = hz([40, 40, 43, 47, 45, 47][b % 6] + [0, 5, 3, 7, 0][b // 6])
    add(start + 0.07, 0.41, lambda t, freq=freq: 0.19 * (1 - math.exp(-t * 150)) * math.exp(-t * 5) * math.sin(2 * math.pi * freq * t))
    if b % 3 == 2:
        freq = hz([78, 76, 74, 71, 78][b // 6])
        add(start + 0.30, 0.40, lambda t, freq=freq: 0.055 * math.exp(-t * 8) * math.sin(2 * math.pi * freq * t))

for cut in (3.6, 7.2, 10.8, 14.4):
    add(cut - 0.35, 0.35, lambda t: 0.07 * rng.uniform(-1, 1) * (t / 0.35) ** 2)

output = Path('public/audio/mzansi-editorial-groove.wav')
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(rate)
    pcm = bytearray()
    for i, value in enumerate(samples):
        fade = min(1, i / (rate * 0.12), (len(samples) - i) / (rate * 0.65))
        pcm.extend(struct.pack('<h', int(math.tanh(value * 1.6) * 29000 * fade)))
    wav.writeframes(pcm)
print(output)
