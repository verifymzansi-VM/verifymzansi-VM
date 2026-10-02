"""Original twenty-second, 120 BPM music bed for the seller advert."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 32000
samples = [0.0] * (20 * rate)
rng = random.Random(182)

def add(start, length, synth):
    for i in range(int(length * rate)):
        pos = int(start * rate) + i
        if pos >= len(samples):
            break
        samples[pos] += synth(i / rate)

def hz(note):
    return 440 * 2 ** ((note - 69) / 12)

for beat in range(40):
    start = beat * 0.5
    add(start, 0.23, lambda t: 0.44 * math.exp(-t * 21) * math.sin(2 * math.pi * (48 * t + 4 * (1 - math.exp(-t * 40)))))
    if beat % 2:
        add(start, 0.12, lambda t: 0.14 * rng.uniform(-1, 1) * math.exp(-t * 32))
    for offset in (0, 0.25, 0.375):
        add(start + offset, 0.045, lambda t: 0.032 * rng.uniform(-1, 1) * math.exp(-t * 90))
    freq = hz([41, 41, 44, 48, 46, 44, 41, 39][beat % 8])
    add(start + 0.07, 0.31, lambda t, freq=freq: 0.17 * math.exp(-t * 6) * math.sin(2 * math.pi * freq * t))
    freq = hz([77, 80, 84, 80, 75, 77, 80, 87][beat % 8])
    if beat % 2 == 0:
        add(start + 0.25, 0.30, lambda t, freq=freq: 0.065 * (1 - math.exp(-t * 120)) * math.exp(-t * 11) * (math.sin(2 * math.pi * freq * t) + 0.20 * math.sin(2 * math.pi * freq * 2 * t)))

for start in (0, 4, 8, 12, 16):
    for note in (53, 56, 60, 63):
        freq = hz(note)
        add(start, 3.8, lambda t, freq=freq: 0.035 * (1 - math.exp(-t * 10)) * math.exp(-t * 0.9) * math.sin(2 * math.pi * freq * t))
    if start:
        add(start - 0.25, 0.25, lambda t: 0.065 * rng.uniform(-1, 1) * (t / 0.25) ** 2)

output = Path('public/audio/mzansi-seller-groove.wav')
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(rate)
    pcm = bytearray()
    for i, sample in enumerate(samples):
        fade = min(1, i / (rate * 0.1), (len(samples) - i) / (rate * 0.55))
        pcm.extend(struct.pack('<h', int(math.tanh(sample * 1.45) * 29000 * fade)))
    wav.writeframes(pcm)
print(output)
