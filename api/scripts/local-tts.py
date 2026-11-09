"""Offline, single-file TTS worker. JSON on stdin; no network or shell access."""
import argparse
import json
import pathlib
import re
import sys
import unicodedata

VOICES = {'yue': 'vits-cantonese-xiaomaiiwn', 'en': 'piper-en-US-lessac-medium'}
DIGITS = '零一二三四五六七八九'
PUNCTUATION = set('，。！？、；：,.!?;:\'"（）()[]【】「」『』“”‘’…—-')
TARGET_RATE = 22050
ENGLISH_WORD = r"[A-Za-z\u00c0-\u024f][A-Za-z0-9\u00c0-\u024f'’\-]*"
ENGLISH_PHRASE = re.compile(ENGLISH_WORD + r"(?:[ \t]+[A-Za-z0-9\u00c0-\u024f][A-Za-z0-9\u00c0-\u024f'’\-]*)*")

class UnsupportedCharacters(ValueError):
    def __init__(self, characters):
        self.characters = sorted(characters)[:12]
        super().__init__('Unsupported voice characters: ' + ''.join(self.characters))

def chinese_number(value):
    raw = str(value)
    if len(raw) > 1 and raw.startswith('0'):
        return ''.join(DIGITS[int(c)] for c in raw)
    value = int(value)
    if value < 10:
        return DIGITS[value]
    if value >= 10000:
        return ''.join(DIGITS[int(c)] for c in str(value))
    result = ''
    pending_zero = False
    for unit, label in [(1000, '千'), (100, '百'), (10, '十'), (1, '')]:
        digit, value = divmod(value, unit)
        if digit:
            if pending_zero:
                result += '零'
            result += ('' if unit == 10 and digit == 1 and not result else DIGITS[digit]) + label
            pending_zero = False
        elif result and value:
            pending_zero = True
    return result

def cantonese_notation(script):
    text = script
    def timezone(match):
        sign = '加' if match[1] == '+' else '减'
        return '，格林威治标准时间' + sign + chinese_number(match[2]) + '小时' + (chinese_number(match[3]) + '分钟' if match[3] else '')
    text = re.sub(r'GMT([+-])(\d{1,2})(?::(\d{2}))?', timezone, text)
    text = re.sub(r'\bGMT\b', '格林威治标准时间', text)
    text = re.sub(r'(?<![a-zA-Z0-9])(\d+)\s*[/／]\s*f(?![a-zA-Z])', lambda m: chinese_number(m[1]) + '楼', text, flags=re.IGNORECASE)
    text = re.sub(r'(?<![a-zA-Z0-9])g\s*[/／]\s*f(?![a-zA-Z])', '地下', text, flags=re.IGNORECASE)
    text = re.sub(r'[/／]', '斜线', text)
    return text

def normalize_cantonese(script, lexicon):
    from opencc import OpenCC
    text = cantonese_notation(script)
    text = re.sub(r'(\d{4})年', lambda m: ''.join(DIGITS[int(c)] for c in m[1]) + '年', text)
    text = re.sub(r'(\d{1,2})[點点](\d{2})分', lambda m: chinese_number(m[1]) + '点' + ('正' if int(m[2]) == 0 else chinese_number(m[2]) + '分'), text)
    text = re.sub(r'\d+', lambda m: chinese_number(m[0]), text)
    text = OpenCC('t2s').convert(text).lower()
    missing = sorted({c for c in text if not c.isspace() and c not in PUNCTUATION and not lexicon.get(c)})
    if missing:
        raise UnsupportedCharacters(missing)
    return text

def normalize_english(script):
    missing = {c for c in script if not (c.isspace() or c.isascii() or 'LATIN' in unicodedata.name(c, '') or c in PUNCTUATION or c in '£€')}
    if missing:
        raise UnsupportedCharacters(missing)
    return script

def speech_segments(script, language, lexicon):
    if language == 'en':
        return [('en', normalize_english(script))]
    text = cantonese_notation(script)
    result = []
    at = 0
    for match in ENGLISH_PHRASE.finditer(text):
        if match.start() > at:
            result.append(('yue', normalize_cantonese(text[at:match.start()], lexicon)))
        result.append(('en', normalize_english(match[0])))
        at = match.end()
    if at < len(text):
        result.append(('yue', normalize_cantonese(text[at:], lexicon)))
    return [(lang, text.strip()) for lang, text in result if text.strip()]

def render_segments(segments, synthesize):
    import numpy as np
    chunks = []
    previous = None
    frames = 0
    for language, text in segments:
        if all(c.isspace() or c in PUNCTUATION for c in text):
            samples = np.zeros(int(TARGET_RATE * 0.12), dtype=np.float32)
        else:
            raw, rate = synthesize(language, text)
            samples = np.asarray(raw, dtype=np.float32).copy()
            if not len(samples) or not np.isfinite(samples).all():
                raise ValueError('Empty generated audio')
            if rate != TARGET_RATE:
                size = round(len(samples) * TARGET_RATE / rate)
                samples = np.interp(np.arange(size) / TARGET_RATE, np.arange(len(samples)) / rate, samples).astype(np.float32)
            rms = float(np.sqrt(np.mean(samples * samples)))
            if rms > 0.001:
                samples *= min(1.5, max(0.75, 0.12 / rms))
            fade = min(round(TARGET_RATE * 0.005), len(samples) // 2)
            if fade:
                samples[:fade] *= np.linspace(0, 1, fade)
                samples[-fade:] *= np.linspace(1, 0, fade)
        if previous is not None and previous != language:
            chunks.append(np.zeros(round(TARGET_RATE * 0.04), dtype=np.float32))
            frames += len(chunks[-1])
        chunks.append(samples)
        frames += len(samples)
        if frames > TARGET_RATE * 600:
            raise ValueError('Audio too long')
        previous = language
    if not chunks:
        raise ValueError('Empty speech')
    return np.concatenate(chunks)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    raw = sys.stdin.buffer.read(100001)
    if len(raw) > 100000:
        raise ValueError('Input too large')
    data = json.loads(raw)
    language, voice, text, speed = (data.get(k) for k in ['language', 'voice', 'script', 'speed'])
    if language not in VOICES or voice != VOICES[language]:
        raise ValueError('Unsupported voice')
    if not isinstance(text, str) or not text.strip() or len(text) > 6000 or '\0' in text:
        raise ValueError('Invalid text')
    if type(speed) not in [float, int] or not 0.7 <= speed <= 1.3:
        raise ValueError('Invalid speed')
    import numpy as np
    import sherpa_onnx
    import lameenc
    lexicon = {}
    if language == 'yue':
        lexicon = {line.split()[0]: line.split()[1:] for line in (args.root / 'yue/lexicon.txt').read_text().splitlines()}
    engines = {}
    def synthesize(lang, chunk):
        if lang not in engines:
            folder = args.root / lang
            if lang == 'yue':
                model = sherpa_onnx.OfflineTtsVitsModelConfig(model=str(folder / 'vits-cantonese-hf-xiaomaiiwn.onnx'), lexicon=str(folder / 'lexicon.txt'), tokens=str(folder / 'tokens.txt'))
            else:
                model = sherpa_onnx.OfflineTtsVitsModelConfig(model=str(folder / 'en_US-lessac-medium.onnx'), tokens=str(folder / 'tokens.txt'), data_dir=str(folder / 'espeak-ng-data'))
            config = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=model, num_threads=2, provider='cpu'), max_num_sentences=1)
            if not config.validate():
                raise ValueError('Invalid installed model')
            engines[lang] = sherpa_onnx.OfflineTts(config)
        generation = sherpa_onnx.GenerationConfig()
        generation.sid = 0
        generation.speed = speed
        audio = engines[lang].generate(chunk, generation)
        return audio.samples, audio.sample_rate
    samples = render_segments(speech_segments(text, language, lexicon), synthesize)
    if not len(samples) or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.001:
        raise ValueError('Empty generated audio')
    # Bound input duration before allocating the encoded output.
    if len(samples) / TARGET_RATE > 600:
        raise ValueError('Audio too long')
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(32)
    encoder.set_in_sample_rate(TARGET_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
    encoded = encoder.encode(pcm) + encoder.flush()
    if len(encoded) > 3 * 1024 * 1024:
        raise ValueError('Audio too large')
    args.output.write_bytes(encoded)

if __name__ == '__main__':
    try:
        main()
    except UnsupportedCharacters as error:
        sys.stderr.write('WORKFORCE_TTS_ERROR ' + json.dumps({'code': 'unsupported_characters', 'characters': error.characters}, ensure_ascii=False) + '\n')
        sys.exit(1)
    except Exception:
        # Parent exposes a controlled error, never raw text, filesystem paths or native logs.
        sys.stderr.write('Local speech generation failed\n')
        sys.exit(1)
