# Фотографии для интерфейса

## Полный каталог и обложки программ — 21 октября 2026

Встроенным `image_gen.imagegen` созданы шесть недостающих фотографий упражнений и четыре предметные обложки программ. Четыре прежние фотографии сохранены. Все финальные изображения находятся здесь в WebP; длинная сторона новых файлов — 1200 px, качество 86. Pillow используется только для уменьшения размера и конвертации формата. Генерация не нужна при запуске приложения.

Новые файлы:

- `public/images/glute_bridge.webp`
- `public/images/wall_sit.webp`
- `public/images/overhead_press.webp`
- `public/images/front_hold.webp`
- `public/images/side_bend.webp`
- `public/images/lateral_raise.webp`
- `public/images/program-bodyweight.webp`
- `public/images/program-floor.webp`
- `public/images/program-dumbbells.webp`
- `public/images/program-holds.webp`

Упражнения показывают человека в соответствующей позиции. Программы используют предметные композиции: общее пространство без веса, коврик, гантели или таймер. `src/programs/catalog.ts` выбирает обложку по всему составу, независимо от порядка и происхождения программы: все упражнения — удержания → таймер; иначе есть гантели → гантели; иначе все движения на полу → коврик; иначе → общая тренировка. Главная использует общую обложку, история аккаунта — состав сохранённого снимка. Обложки не меняют программу, её версии или результаты.

Промпты новых файлов (точный текст):

## glute_bridge.webp

> Use case: photorealistic-natural. Asset type: single exercise photograph for PlayFit fitness application. Primary request: real adult athletic woman performing a bodyweight glute bridge at the top of the movement. Side view, full body from head to shoes, head and shoulders resting on a dark grey exercise mat, hips raised, knees bent, both feet flat on floor, arms resting alongside body. Realistic unretouched skin, natural human proportions, brunette ponytail, plain black sports top, black leggings, white trainers. Bright minimalist home fitness studio, warm grey wall, pale oak floor, soft window daylight, subtle blurred green plant. Premium real editorial sports photography, NOT 2D illustration or 3D render. Landscape 3:2, centered entire pose with generous margin for responsive cards, no cropping hands feet or head. No text, no logos, no diagrams, no watermark.

## wall_sit.webp

> Use case: photorealistic-natural. Asset type: single exercise photograph for PlayFit fitness application. Real adult athletic woman performing a wall sit against a plain warm grey wall, back supported by wall, hips and knees bent about ninety degrees, thighs horizontal, both feet flat on floor, hands lightly together in front of chest. Three quarter side view, full body including shoes with generous margin. Brunette ponytail, plain black sports top, black leggings, white trainers, natural realistic skin and anatomy. Bright minimalist home fitness studio with pale oak floor, soft window daylight. Real editorial sports photography, NOT illustration or 3D render. Landscape 3:2, entire pose centered for responsive cards. No chair, no text, no logos, no diagrams, no watermark.

## overhead_press.webp

> Use case: photorealistic-natural. Asset type: single exercise photograph for PlayFit fitness application. Real adult athletic woman doing a standing dumbbell overhead press, BOTH arms extended overhead with slight natural bend in elbows, a small dark hex dumbbell visibly gripped in each hand, palms facing forward, feet shoulder width apart. Front view, full body INCLUDING both weights above head and both shoes, generous empty margin around entire pose. Brunette ponytail, plain black sports top, black leggings, white trainers. Natural skin texture, realistic human anatomy. Bright minimalist home fitness studio, warm grey wall, pale oak floor, subtle blurred green plant, soft natural window light. Premium real editorial sports photography, NOT illustration or CGI. Landscape 3:2. No text, logos, diagrams, watermark.

## front_hold.webp

> Use case: photorealistic-natural. Asset type: single exercise photograph for PlayFit fitness application. Real adult athletic woman holding two small dark hex dumbbells straight in FRONT of her at shoulder height, both almost straight arms extended parallel forward, torso upright, feet planted shoulder width. Three quarter SIDE VIEW clearly showing forward arms, both hands and weights visible with slight perspective separation. Full body including shoes, generous margin around entire body and weights. Brunette ponytail, plain black sports top, black leggings, white trainers. Natural skin texture and correct human anatomy. Bright minimalist home fitness studio, warm grey wall, pale oak floor, soft window daylight, subtle blurred green plant. Premium editorial PHOTO of a real human, not illustration or render. Landscape 3:2. No text, logos, diagrams or watermark.

## side_bend.webp

> Use case: photorealistic-natural. Asset type: single exercise photograph for PlayFit fitness application. Real adult athletic woman performing a standing dumbbell SIDE BEND, front view. Hips centered above stable feet shoulder width apart, torso visibly tilted moderately to her right side, both arms hanging naturally down beside thighs, one small dark hex dumbbell in each hand; right hand lower near side of knee, left hand near left upper thigh. No raised arms, no forward bend. Brunette ponytail, plain black sports top, black leggings, white trainers, natural realistic human anatomy and skin. Full body including both shoes and both dumbbells, generous margin. Bright minimalist home studio, warm grey wall, pale oak floor, soft natural window light, subtle blurred plant. Premium editorial fitness PHOTO, not 2D illustration or CGI. Landscape 3:2. No text, logos, diagrams, watermark.

## lateral_raise.webp

> Use case: photorealistic-natural. Asset type: single exercise photograph for PlayFit fitness application. Real adult athletic woman performing a standing dumbbell lateral raise at top position, FRONT VIEW: both arms spread OUT TO THE SIDES horizontally at shoulder height, elbows slightly bent, one small dark hex dumbbell in each hand. Upright torso, feet shoulder width apart. Full body including shoes and both outstretched weights fully inside frame with generous side margins. Brunette ponytail, plain black sports top, black leggings, white trainers, natural skin texture and anatomically realistic human. Bright minimalist home studio, warm grey wall, pale oak floor, soft natural window daylight, subtle blurred green plant. Premium editorial real sports PHOTOGRAPH, NOT illustration or 3D. Landscape 3:2. No text, logos, diagrams, watermark.

## program-bodyweight.webp

> Use case: photorealistic-natural. Asset type: program cover image in an existing fitness application, landscape 3:2. A premium editorial still life PHOTOGRAPH of a thoughtfully prepared minimal home workout space WITHOUT PEOPLE. Warm light grey plaster wall, pale oak floor, soft directional window daylight, refined natural material textures, restrained grey and black palette with one subtle muted lime accent. Arrange main objects in central two thirds so cover survives wide 2:1 and portrait crops. Clean real photographic material detail, uncluttered scene, no humans, no human silhouettes, no body parts, no text, no readable digits, no logos, no graphics, no UI, no watermarks. Subject: a pair of clean off-white athletic trainers beside a folded charcoal exercise towel and a matte lime green reusable water bottle; behind them a partially unrolled dark grey exercise mat and a generous clear patch of floor ready for a bodyweight circuit. Low three quarter camera view; welcoming, focused mood.

## program-floor.webp

> Use case: photorealistic-natural. Asset type: program cover image in an existing fitness application, landscape 3:2. A premium editorial still life PHOTOGRAPH of a thoughtfully prepared minimal home workout space WITHOUT PEOPLE. Warm light grey plaster wall, pale oak floor, soft directional window daylight, refined natural material textures, restrained grey and black palette with one subtle muted lime accent. Arrange main objects in central two thirds so cover survives wide 2:1 and portrait crops. Clean real photographic material detail, uncluttered scene, no humans, no human silhouettes, no body parts, no text, no readable digits, no logos, no graphics, no UI, no watermarks. Subject: a dark graphite exercise mat unrolled across the floor, its near edge subtly curled showing ribbed texture, a neatly folded light grey towel resting on one end and a matte muted lime green water bottle beside it. No weights or dumbbells. Low three quarter view, calm floor workout atmosphere.

## program-dumbbells.webp

> Use case: photorealistic-natural. Asset type: program cover image in an existing fitness application, landscape 3:2. A premium editorial still life PHOTOGRAPH of a thoughtfully prepared minimal home workout space WITHOUT PEOPLE. Warm light grey plaster wall, pale oak floor, soft directional window daylight, refined natural material textures, restrained grey and black palette with one subtle muted lime accent. Arrange main objects in central two thirds so cover survives wide 2:1 and portrait crops. Clean real photographic material detail, uncluttered scene, no humans, no human silhouettes, no body parts, no text, no readable digits, no logos, no graphics, no UI, no watermarks. Subject: exactly two compact black rubber HEX DUMBBELLS with brushed metal grips arranged neatly in the foreground, one resting parallel to the other at a slight diagonal. A neatly folded grey towel and matte muted lime green water bottle behind them. Dumbbells are the clear main subject, realistic sports product photography, close three quarter view.

## program-holds.webp

> Use case: photorealistic-natural. Asset type: program cover image in an existing fitness application, landscape 3:2. A premium editorial still life PHOTOGRAPH of a thoughtfully prepared minimal home workout space WITHOUT PEOPLE. Warm light grey plaster wall, pale oak floor, soft directional window daylight, refined natural material textures, restrained grey and black palette with one subtle muted lime accent. Arrange main objects in central two thirds so cover survives wide 2:1 and portrait crops. Clean real photographic material detail, uncluttered scene, no humans, no human silhouettes, no body parts, no text, no readable digits, no logos, no graphics, no UI, no watermarks. Subject: a small plain round black analogue stopwatch resting on a folded grey towel in the foreground, no numerals on its simple face, beside a graphite exercise mat, plain wall and a small matte muted lime green bottle. A pair of compact black hex dumbbells sits farther back to the side, all main items grouped centrally. Stillness and controlled time-based training, low three quarter view.


## Первая серия: четыре исходные фотографии

Созданы встроенным `image_gen.imagegen` (не CLI и не внешний API приложения) 21 октября 2026. Это сгенерированные иллюстративные фотографии для карточек, а не реальные записи тренировок, распознанные кадры или подтверждение техники. Исходные PNG сохранены инструментом в `.codex/generated_images`; проект содержит оптимизированные WebP. Runtime не обращается к сервисам генерации.

Итоговые файлы относительно корня проекта:

- `public/images/squat.webp`
- `public/images/pushup.webp`
- `public/images/reverse_lunge.webp`
- `public/images/forearm_plank.webp`

Промпты генерации:

## squat.webp

> Use case: photorealistic-natural. Asset type: exercise photograph for existing fitness app cards. Create a high quality editorial fitness photograph, portrait 2:3 composition. One athletic adult woman in simple black sports bra, black leggings and white sneakers doing a bodyweight squat, hands together in front of chest, three quarter side view, entire body including feet visible, centered with generous margin. Bright minimal home workout studio, warm gray wall, pale wood floor, small out of focus green plant at left, soft natural daylight. Clean realistic anatomy, subtle neutral palette, premium fitness editorial. No text, no icons, no graphics, no panels, no UI, no watermark. Save final generated asset for use in project.

## pushup.webp

> Use case photorealistic-natural. Asset type: a single fitness editorial photograph for an exercise card in a web app. Landscape 3:2 composition. Athletic adult woman with brown ponytail wearing black sports bra, black leggings and white sneakers doing a push up, hands and toes on the floor, elbows bent around 90 degrees, straight body line, accurate anatomy. Full body including head hands feet visible with ample margin all around. Side view. Minimal bright warm gray home workout studio, pale wooden floor, subtle plant out of focus. Soft natural light. Premium editorial natural realistic photography. No text, no graphics, no UI, no icons, no panels, no watermark.

## reverse_lunge.webp

> Use case: photorealistic-natural. A single premium fitness editorial photograph, portrait composition. Athletic adult woman with brown ponytail, black sports bra and black leggings, white sneakers, performing a reverse lunge in three quarter side view. Front knee bent ninety degrees, rear knee near floor, hands clasped in front of chest. Whole body visible including feet, ample margin. Bright minimal home studio with pale wooden floor, warm gray wall, small out of focus plant, soft natural daylight. Natural correct anatomy. No text, graphics, UI, watermarks.

## forearm_plank.webp

> Use case: photorealistic-natural. A single premium fitness editorial photograph, landscape composition. Athletic adult woman with brown ponytail, black sports bra and black leggings, white sneakers, holding a forearm plank on a dark gray yoga mat. Elbows directly below shoulders, forearms on floor, straight torso and legs, toes on floor. Entire body visible including head and feet, ample margin. Side view, bright minimal home studio with pale wooden floor, warm gray wall, small out of focus plant, soft natural daylight. Natural correct anatomy. No text, graphics, UI, watermark.
