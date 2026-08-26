"""The worker's own rules, exercised with a stub session and no model.

What is worth pinning is not that LaMa paints nice sky — it is that a HOSTILE
model output cannot move one byte outside the mask, that a degenerate request
is refused rather than served, and that the two export conventions decode to
the same picture. Run with:  python -m unittest test_inpaint_core -v
"""

import unittest

import numpy as np

from inpaint_core import (
    InpaintRefused, MAX_MASK_SHARE, binarise_mask, composite_masked,
    inpaint, prepare_feeds, read_output, validate_pair,
)
from model_manifest import MODEL_EDGE


class Meta:
    def __init__(self, name, shape):
        self.name = name
        self.shape = shape


class StubSession:
    """The export's contract: image [1,3,E,E] 0..1 in, mask [1,1,E,E] in."""

    def __init__(self, respond, image_first=True, edge=MODEL_EDGE):
        self.respond = respond
        self.calls = []
        inputs = [
            Meta("image", [1, 3, edge, edge]),
            Meta("mask", [1, 1, edge, edge]),
        ]
        self.inputs = inputs if image_first else list(reversed(inputs))

    def get_inputs(self):
        return self.inputs

    def run(self, _outputs, feeds):
        self.calls.append(feeds)
        return [self.respond(feeds)]


def picture(edge=MODEL_EDGE):
    rng = np.random.default_rng(7)
    return rng.integers(0, 255, size=(edge, edge, 3), dtype=np.uint8).astype(np.uint8)


def badge_mask(edge=MODEL_EDGE):
    mask = np.zeros((edge, edge), dtype=np.uint8)
    mask[40:120, 60:300] = 1
    return mask


def magenta(feeds):
    """A hostile model: a completely different image, every pixel changed."""
    image = next(value for value in feeds.values() if value.shape[1] == 3)
    edge = image.shape[2]
    out = np.zeros((1, 3, edge, edge), dtype=np.float32)
    out[0, 0] = 255.0
    out[0, 2] = 255.0
    return out


class FeedsTest(unittest.TestCase):
    def test_inputs_are_matched_by_channel_count_not_order(self):
        for image_first in (True, False):
            session = StubSession(magenta, image_first=image_first)
            feeds = prepare_feeds(session, picture(), badge_mask())
            self.assertEqual(feeds["image"].shape, (1, 3, MODEL_EDGE, MODEL_EDGE))
            self.assertEqual(feeds["mask"].shape, (1, 1, MODEL_EDGE, MODEL_EDGE))
            self.assertLessEqual(float(feeds["image"].max()), 1.0)
            self.assertEqual(set(np.unique(feeds["mask"])), {0.0, 1.0})

    def test_a_model_with_the_wrong_inputs_is_refused(self):
        session = StubSession(magenta)
        session.inputs = [Meta("weird", [1, 4, 512, 512])]
        with self.assertRaises(InpaintRefused):
            prepare_feeds(session, picture(), badge_mask())


class OutputTest(unittest.TestCase):
    def test_both_export_value_ranges_decode_identically(self):
        base = np.random.default_rng(3).random((1, 3, 32, 32)).astype(np.float32)
        low = read_output(base)
        high = read_output(base * 255.0)
        self.assertTrue(np.array_equal(low, high))
        self.assertEqual(low.shape, (32, 32, 3))

    def test_nonsense_is_refused(self):
        with self.assertRaises(InpaintRefused):
            read_output(np.zeros((7,), dtype=np.float32))


class CompositeTest(unittest.TestCase):
    def test_hostile_output_cannot_touch_a_pixel_outside_the_mask(self):
        image = picture()
        mask = badge_mask()
        result = inpaint(StubSession(magenta), image, mask)

        outside = mask == 0
        self.assertTrue(np.array_equal(result[outside], image[outside]))
        # And inside, the model's answer did land — this is a repair, not a no-op.
        self.assertFalse(np.array_equal(result[mask == 1], image[mask == 1]))

    def test_caller_resolution_is_preserved_even_when_the_model_resizes(self):
        image = picture(320)
        mask = np.zeros((320, 320), dtype=np.uint8)
        mask[30:90, 40:200] = 1
        result = inpaint(StubSession(magenta), image, mask)

        self.assertEqual(result.shape, image.shape)
        outside = mask == 0
        self.assertTrue(np.array_equal(result[outside], image[outside]))

    def test_mismatched_shapes_are_refused(self):
        with self.assertRaises(InpaintRefused):
            composite_masked(picture(64), picture(32), badge_mask(64))


class RefusalTest(unittest.TestCase):
    def test_an_empty_mask_is_refused(self):
        with self.assertRaises(InpaintRefused):
            validate_pair(picture(), np.zeros((MODEL_EDGE, MODEL_EDGE), np.uint8))

    def test_a_regenerate_everything_mask_is_refused(self):
        mask = np.ones((MODEL_EDGE, MODEL_EDGE), dtype=np.uint8)
        with self.assertRaises(InpaintRefused):
            validate_pair(picture(), mask)
        self.assertLess(MAX_MASK_SHARE, 1.0)

    def test_mismatched_sizes_are_refused(self):
        with self.assertRaises(InpaintRefused):
            validate_pair(picture(256), badge_mask(MODEL_EDGE))


class MaskTest(unittest.TestCase):
    def test_white_marks_the_hole_and_antialiasing_does_not_widen_it(self):
        mask_rgb = np.zeros((16, 16, 3), dtype=np.uint8)
        mask_rgb[4:8, 4:8] = 255      # drawn
        mask_rgb[8, 4:8] = 100        # anti-aliased edge: below threshold
        mask = binarise_mask(mask_rgb)
        self.assertEqual(int(mask[5, 5]), 1)
        self.assertEqual(int(mask[8, 5]), 0)


if __name__ == "__main__":
    unittest.main()
