---
SECTION_ID: files.assets.game.background_texture_png
TYPE: file/image
---

# Background Texture — Deep Bioluminescent Underwater Micro-World

FILE: assets/game/background_texture.png
UTILITY: gpt_image
WIDTH: 1024
HEIGHT: 1024
QUALITY: high
IMAGE-INPUT: assets/game/background_texture.png

PROMPT: |
  Edit this underwater background texture. Preserve all existing qualities — soft blue gradient, top-down light rays, subtle particles, dark edges — and apply these refinements only:

  1. FLOWING WATER PATTERNS:
  Add very subtle soft wave distortions across the texture — like gentle horizontal and diagonal ripple flows seen from above. Extremely low contrast, completely blurred, no sharp lines. Opacity max 4%. Suggest slow water movement without any recognizable shapes.

  2. GENTLE LIGHT PATCHES:
  Introduce 3–5 very soft, large, completely blurred bright patches scattered across the mid-section — like sunlight pooling through shallow water. Warm pale cyan-white, max 6% opacity. No hard edges, no defined shapes. Organic and irregular placement.

  3. CENTER BRIGHTNESS:
  Slightly increase brightness in the center area — a very soft radial glow, warm teal-white, max 8% brighter than surroundings. Edges remain darker. Creates natural focus point without harsh contrast.

  4. PRESERVE EVERYTHING ELSE:
  - Keep existing top-down light rays and surface lighting exactly as-is
  - Keep existing subtle particles (do not add more)
  - Keep deep navy / dark teal color palette
  - Keep seamless tileable edges — no visible seams
  - Keep low contrast throughout — no element brighter than 18% luminance
  - No green tones, no objects, no plants, no rocks, no shapes
  - Non-distracting — background serves gameplay readability

COMMENTS: ## Design Notes
- Must not compete visually with cyan amoeba agents, green food leaves, blue vortexes, or grey rocks
- Avoid any green tones — food (leaves) must remain visually unique
- Surface lighting (top-down) is the key new mood element — keep it soft and diffuse
- Caustics add life without noise — keep them blurred and low contrast
- Seamless tiling is critical for performance-optimized game use
- Low contrast is the primary constraint — background serves readability, not aesthetics
- Will be upscaled to 2048x2048 via image_upscale_ai after generation
