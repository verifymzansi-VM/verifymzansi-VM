# Showroom artwork

Generated with the built-in imagegen tool, in a modern editorial photography
style. These are illustrative South African scenes, not photographs of specific
listed businesses or venues.

Routes: homepage, Mzansi Market, Mzansi Business, and the combined Tourism &
Events route (`/tourism-events`, backed by `promotions/page.tsx`).

Assets:
`public/images/showrooms/{home,market,business,tourism}-v2-{desktop,mobile}.avif`.

Desktop: 1152 × 648. Mobile: 600 × 800. Maximum budgets: 40,642 bytes desktop
(the previous background size), 32,000 bytes mobile. The browser selects a
single image with native picture media selection; landscape phones use the
desktop composition. Static compression requires no image transformation server
or added client JavaScript. Decorative artwork uses low fetch priority,
asynchronous decoding, and absolute positioning to avoid changing the carousel
dimensions.

Regenerate compressed assets with
`node scripts/optimize-showroom-artwork.cjs <source-directory>`. Source IDs are
recorded in that script. Keep source PNGs outside public assets.

## Final prompts

Validation: 53 focused Vitest tests passed; TypeScript and changed-file ESLint
checks passed. Chromium checked all four routes at 1440×900, 390×844, and
740×390. Each of the 12 fresh page loads selected the expected composition,
decoded successfully, and requested exactly one background asset. Desktop files
are 36,188–40,035 bytes; mobile files are 28,693–31,710 bytes. This validates
image delivery and responsive fit, not a production Core Web Vitals benchmark.

### home Desktop

Create a photorealistic architectural editorial background for VerifyMzansi, a
South African local marketplace and business discovery website. Landscape 16:9
composition. A welcoming contemporary South African community courtyard with
warm sandstone paving, shaded independent shopfronts at the outer edges,
indigenous planting, subtle ochre and forest green accents, distant Highveld
trees under warm morning light. Authentic upscale but accessible local
character. Calm central open space for overlaying large product cards; visual
interest on edges and upper third. No text, logos, watermarks, flags or close-up
people. Natural material textures, restrained detail, polished photography, not
a collage.

### home Mobile

Create a photorealistic architectural editorial background for VerifyMzansi, a
South African local marketplace and business discovery website. Portrait 3:4
mobile composition. Recompose the courtyard so shops and planting remain visible
along the narrow side edges, canopy across the top, open middle for a tall
listing card. A welcoming contemporary South African community courtyard with
warm sandstone paving, shaded independent shopfronts at the outer edges,
indigenous planting, subtle ochre and forest green accents, distant Highveld
trees under warm morning light. Authentic upscale but accessible local
character. Calm central open space for overlaying large product cards; visual
interest on edges and upper third. No text, logos, watermarks, flags or close-up
people. Natural material textures, restrained detail, polished photography, not
a collage.

### market Desktop

Modern editorial photography for a South African online marketplace hero
background. Landscape 16:9. Contemporary lively urban neighbourhood market in
South Africa, sleek modular emerald-green retail kiosks, modern streetwear and
sneakers neatly displayed at left, homeware and small electronics displayed at
right, stylish corrugated metal, clean concrete plaza, bold terracotta
architectural panels, a few small distant diverse South African shoppers
naturally walking. Not a rustic craft bazaar, not a luxury resort. Fresh
confident everyday commerce. Bright overcast daylight, clean architectural
lines, authentic urban atmosphere. Keep center foreground broad and uncluttered
to overlay website product cards, key visual cues at outer edges and upper
third. High-end editorial photography, coherent single real-world scene, no
collage, no readable text, logos, watermarks or flags.

### market Mobile

Modern editorial photography for a South African online marketplace hero
background. Portrait 3:4 mobile composition, kiosks closely framing narrow side
edges, clear sky and distant architecture above, broad tall empty center for a
listing card. Contemporary lively urban neighbourhood market in South Africa,
sleek modular emerald-green retail kiosks, modern streetwear and sneakers neatly
displayed at left, homeware and small electronics displayed at right, stylish
corrugated metal, clean concrete plaza, bold terracotta architectural panels, a
few small distant diverse South African shoppers naturally walking. Not a rustic
craft bazaar, not a luxury resort. Fresh confident everyday commerce. Bright
overcast daylight, clean architectural lines, authentic urban atmosphere. Keep
center foreground broad and uncluttered to overlay website product cards, key
visual cues at outer edges and upper third. High-end editorial photography,
coherent single real-world scene, no collage, no readable text, logos,
watermarks or flags.

### business Desktop

Modern editorial architectural photography for South African business directory
hero background. Landscape 16:9. Ground-level view through a dynamic
Johannesburg commercial precinct blending contemporary glass office buildings
with repurposed brick small-business studios, attractive charcoal steel
canopies, blue architectural accents, jacaranda trees, subtle distant
Johannesburg skyline. A few small diverse South African entrepreneurs in smart
casual clothes conversing near side entrances. A broad clean central pedestrian
plaza kept empty for website listing cards. Modern South African enterprise from
local firms to growing professional services, not an empty coworking room or
resort. Soft clear morning light, cool slate blue and warm brick color balance.
Premium coherent single photograph, no collage, no readable text, branding,
signs, flags or watermark. Visual interest along outer edges and upper third.

### business Mobile

Modern editorial architectural photography for South African business directory
hero background. Portrait 3:4 mobile composition. Frame narrow side edges with
modern business facades and jacarandas, skyline in upper third, tall calm
central plaza for overlaying a website listing card. Ground-level view through a
dynamic Johannesburg commercial precinct blending contemporary glass office
buildings with repurposed brick small-business studios, attractive charcoal
steel canopies, blue architectural accents, jacaranda trees, subtle distant
Johannesburg skyline. A few small diverse South African entrepreneurs in smart
casual clothes conversing near side entrances. A broad clean central pedestrian
plaza kept empty for website listing cards. Modern South African enterprise from
local firms to growing professional services, not an empty coworking room or
resort. Soft clear morning light, cool slate blue and warm brick color balance.
Premium coherent single photograph, no collage, no readable text, branding,
signs, flags or watermark. Visual interest along outer edges and upper third.

### tourism Desktop

Modern editorial travel and culture photograph for South African Tourism &
Events website hero background. Landscape 16:9. Contemporary open-air cultural
festival venue on the KwaZulu-Natal coastline: bright turquoise Indian Ocean,
lush rolling green coastal hills and indigenous strelitzia planting, modern
timber boardwalk and clean pale plaza, elegant small outdoor performance stage
with dark canopy at far left, a few festival food kiosks and warm festoon lights
at far right. A few tiny diverse visitors at edges, relaxed aspirational local
weekend atmosphere, natural late afternoon light, not a wedding resort. A broad
calm central foreground for website cards to overlay, scenic ocean and hills
visible in upper third. A coherent realistic single location inspired by South
Africa, no impossible landmark collage. Premium crisp editorial photography. No
text, logos, flags, watermark.

### tourism Mobile

Modern editorial travel and culture photograph for South African Tourism &
Events website hero background. Portrait 3:4 mobile composition. Keep small
stage tucked at left edge, festoon lights and kiosks at right edge, ocean and
green hills across upper third, tall calm central plaza for a website listing
card. Contemporary open-air cultural festival venue on the KwaZulu-Natal
coastline: bright turquoise Indian Ocean, lush rolling green coastal hills and
indigenous strelitzia planting, modern timber boardwalk and clean pale plaza,
elegant small outdoor performance stage with dark canopy at far left, a few
festival food kiosks and warm festoon lights at far right. A few tiny diverse
visitors at edges, relaxed aspirational local weekend atmosphere, natural late
afternoon light, not a wedding resort. A broad calm central foreground for
website cards to overlay, scenic ocean and hills visible in upper third. A
coherent realistic single location inspired by South Africa, no impossible
landmark collage. Premium crisp editorial photography. No text, logos, flags,
watermark.
