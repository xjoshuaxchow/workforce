import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[1] / 'scripts/local-tts.py'
spec = importlib.util.spec_from_file_location('local_tts', path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class NormalizationTest(unittest.TestCase):
    def test_mixed_speech_keeps_english_phrase_and_cantonese_floor(self):
        lexicon = {c: ['phoneme'] for c in '地點係点系香港九龙长沙湾永康街九号二十八楼，。'}
        segments = worker.speech_segments('地點係tech nine，香港九龍長沙灣永康街9號28/F。', 'yue', lexicon)
        self.assertEqual([lang for lang, text in segments], ['yue', 'en', 'yue'])
        self.assertEqual(segments[1][1], 'tech nine')
        self.assertIn('九号二十八楼', segments[2][1])
        self.assertFalse(any('/' in text for lang, text in segments))

    def test_english_acronyms_and_brand_numbers_are_not_changed_to_chinese(self):
        lexicon = {c: ['phoneme'] for c in '请带，到九楼。'}
        segments = worker.speech_segments('請帶ID，到Tech 9。', 'yue', lexicon)
        self.assertEqual([text for lang, text in segments if lang == 'en'], ['ID', 'Tech 9'])

    def test_both_languages_are_present_in_the_combined_pcm(self):
        import numpy as np
        def synthesize(language, text):
            return np.full(1000, 0.3 if language == 'yue' else -0.3, dtype=np.float32), 22050
        pcm = worker.render_segments([('yue','地點係'),('en','tech nine')], synthesize)
        self.assertGreater(float(pcm.max()), 0.1)
        self.assertLess(float(pcm.min()), -0.1)
        self.assertLess(int(np.argmax(pcm)), int(np.argmin(pcm)))
        self.assertTrue(np.isfinite(pcm).all())

    def test_hong_kong_floor_address_is_spoken_instead_of_rejected(self):
        lexicon = {c: ['phoneme'] for c in '香港九龙长沙湾永康街九号二十八楼t e c h n i g地下一斜线a b'}
        result = worker.normalize_cantonese('tech nine，香港九龍長沙灣永康街9號28/F', lexicon)
        self.assertIn('九号二十八楼', result)
        self.assertNotIn('/', result)
        self.assertIn('地下', worker.normalize_cantonese('G/F', lexicon))
        self.assertIn('斜线', worker.normalize_cantonese('A/B', lexicon))

    def test_traditional_dates_keys_and_offsets_remain_spoken(self):
        lexicon = {c: ['phoneme'] for c in '测试湾办公室龙二零九九年十一月日点正格林威治标准时间加八小时接受请按拒绝再听次三分，。'}
        result = worker.normalize_cantonese('測試灣辦公室。2099年11月10日9點00分 GMT+8。接受請按1，拒絕請按2，再聽一次請按9。', lexicon)
        self.assertIn('测试湾办公室', result)
        self.assertIn('二零九九年十一月十日九点正', result)
        self.assertIn('加八小时', result)
        self.assertIn('接受请按一', result)
        self.assertIn('拒绝请按二', result)
        self.assertIn('再听一次请按九', result)

    def test_unknown_characters_are_rejected_instead_of_silently_skipped(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported voice characters'):
            worker.normalize_cantonese('罕見字', {})

    def test_numbers_preserve_zeroes_and_tens(self):
        for value, expected in [(10,'十'),(11,'十一'),(20,'二十'),(101,'一百零一'),(1001,'一千零一'),(1010,'一千零一十')]:
            self.assertEqual(worker.chinese_number(value), expected)

    def test_leading_zeroes_in_room_and_phone_numbers_are_preserved(self):
        lexicon = {c: ['phoneme'] for c in '到零一二三四五六七八九号室请致电。'}
        result = worker.normalize_cantonese('到007號室，請致電01234567。', lexicon)
        self.assertIn('零零七号室', result)
        self.assertIn('零一二三四五六七', result)

    def test_unsupported_semantic_symbols_are_not_silently_dropped(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported voice characters'):
            worker.normalize_cantonese('🪪', {})

    def test_english_rejects_text_outside_its_voice_language(self):
        self.assertEqual(worker.normalize_english('Kowloon Bay, 10 November at 09:00.'), 'Kowloon Bay, 10 November at 09:00.')
        for text in ['九龍灣', 'Bring 🪪']:
            with self.assertRaisesRegex(ValueError, 'Unsupported voice characters'):
                worker.normalize_english(text)

if __name__ == '__main__':
    unittest.main()
