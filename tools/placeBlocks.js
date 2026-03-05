/**
 * Smart Place Blocks / Build Structures Tool
 * Enables the bot to place individual blocks and build structures using
 * pre-built blueprints with intelligent material selection and auto-gathering.
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

module.exports = function placeBlocks(bot, gatherResourceTool) {
    console.error('[PlaceBlocks] Smart tool loaded');

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Blocks that should be cleared (broken) before placing.
     * These are non-solid vegetation / decorations that get in the way.
     */
    const CLEARABLE_BLOCKS = new Set([
        'grass', 'short_grass', 'tall_grass', 'fern', 'large_fern',
        'dead_bush', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant',
        'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
        'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
        'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'torchflower',
        'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant',
        'wither_rose', 'sweet_berry_bush',
        'snow', 'vine', 'sugar_cane',
    ]);

    // ─── Inventory Helpers ────────────────────────────────────────────

    /**
     * Get count of a specific item in inventory
     */
    function getItemCount(itemName) {
        return bot.inventory.items()
            .filter(item => item.name === itemName)
            .reduce((sum, item) => sum + item.count, 0);
    }

    /**
     * Get all placeable blocks in inventory with their counts.
     * Filters out tools, weapons, food, armour, and other non-block items.
     */
    function getPlaceableBlocks() {
        const nonPlaceable = new Set([
            // Tools & weapons
            'wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword', 'netherite_sword',
            'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe',
            'wooden_axe', 'stone_axe', 'iron_axe', 'golden_axe', 'diamond_axe', 'netherite_axe',
            'wooden_shovel', 'stone_shovel', 'iron_shovel', 'golden_shovel', 'diamond_shovel', 'netherite_shovel',
            'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe', 'netherite_hoe',
            'bow', 'crossbow', 'trident', 'shield', 'flint_and_steel', 'shears', 'fishing_rod',
            'compass', 'clock', 'spyglass', 'lead', 'name_tag', 'map', 'filled_map',
            // Armour
            'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots',
            'chainmail_helmet', 'chainmail_chestplate', 'chainmail_leggings', 'chainmail_boots',
            'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
            'golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots',
            'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
            'netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots',
            // Food & consumables
            'apple', 'golden_apple', 'enchanted_golden_apple', 'bread', 'cooked_beef',
            'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit',
            'cooked_cod', 'cooked_salmon', 'mushroom_stew', 'beetroot_soup',
            'raw_beef', 'raw_porkchop', 'raw_chicken', 'raw_mutton', 'raw_rabbit',
            'raw_cod', 'raw_salmon', 'potato', 'baked_potato', 'carrot', 'beetroot',
            'melon_slice', 'sweet_berries', 'cookie', 'pumpkin_pie', 'cake',
            'potion', 'splash_potion', 'lingering_potion',
            // Raw materials & ingots (not blocks)
            'diamond', 'emerald', 'iron_ingot', 'gold_ingot', 'netherite_ingot',
            'iron_nugget', 'gold_nugget', 'coal', 'charcoal', 'lapis_lazuli',
            'redstone', 'quartz', 'stick', 'string', 'feather', 'leather',
            'bone', 'bone_meal', 'gunpowder', 'blaze_rod', 'blaze_powder',
            'ender_pearl', 'ender_eye', 'ghast_tear', 'slime_ball', 'magma_cream',
            'nether_star', 'prismarine_shard', 'prismarine_crystals', 'rabbit_hide',
            'phantom_membrane', 'nautilus_shell', 'heart_of_the_sea',
            'flint', 'wheat', 'wheat_seeds', 'pumpkin_seeds', 'melon_seeds',
            'beetroot_seeds', 'sugar', 'paper', 'book', 'experience_bottle',
            'arrow', 'spectral_arrow', 'tipped_arrow', 'firework_rocket',
            // Misc non-placeable
            'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket',
            'minecart', 'saddle', 'elytra', 'totem_of_undying',
            'written_book', 'writable_book', 'enchanted_book',
        ]);

        const blockCounts = {};
        for (const item of bot.inventory.items()) {
            if (nonPlaceable.has(item.name)) continue;
            // Additional heuristic: skip anything ending in known non-block suffixes
            if (item.name.endsWith('_dye') || item.name.endsWith('_spawn_egg')) continue;
            blockCounts[item.name] = (blockCounts[item.name] || 0) + item.count;
        }
        return blockCounts;
    }

    /**
     * Equip the specified block in the bot's hand
     */
    async function equipBlock(blockName) {
        const item = bot.inventory.items().find(i => i.name === blockName);
        if (!item) {
            throw new Error(`No ${blockName} in inventory`);
        }
        await bot.equip(item, 'hand');
        return item;
    }

    // ─── World Helpers ────────────────────────────────────────────────

    /**
     * Find the surface Y at a given (x, z) — the highest solid block
     */
    function getSurfaceY(x, z) {
        for (let y = 256; y >= 0; y--) {
            const block = bot.blockAt(new Vec3(Math.floor(x), y, Math.floor(z)));
            if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
                return y;
            }
        }
        return 64;
    }

    /**
     * Resolve build origin near the bot's current position, offset +2 to avoid self-overlap.
     */
    function resolveBuildOrigin() {
        const botPos = bot.entity.position;
        const rx = Math.floor(botPos.x) + 2;
        const rz = Math.floor(botPos.z) + 2;
        const ry = getSurfaceY(rx, rz) + 1;
        console.error(`[PlaceBlocks] Build origin resolved to (${rx}, ${ry}, ${rz})`);
        return { x: rx, y: ry, z: rz };
    }

    /**
     * Navigate close enough to place a block at the target position
     */
    async function moveNear(target) {
        const mcData = require('minecraft-data')(bot.version);
        const dist = bot.entity.position.distanceTo(target);
        if (dist > 4.5) {
            bot.pathfinder.setMovements(new Movements(bot, mcData));
            const goal = new goals.GoalNear(target.x, target.y, target.z, 3);
            await bot.pathfinder.goto(goal);
            await sleep(200);
        }
    }

    // ─── Single Block Placement ───────────────────────────────────────

    /**
     * Place a single block at (x, y, z).
     * Finds an adjacent solid face to place against.
     */
    async function placeSingleBlock(blockName, x, y, z) {
        const pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

        const existing = bot.blockAt(pos);
        if (existing && existing.name !== 'air' && existing.name !== 'cave_air' && existing.name !== 'void_air') {
            // If it's a clearable block (grass, flowers, etc.), break it first
            if (CLEARABLE_BLOCKS.has(existing.name)) {
                try {
                    console.error(`[PlaceBlocks] Clearing ${existing.name} at (${pos.x}, ${pos.y}, ${pos.z})`);
                    await moveNear(pos);
                    await bot.dig(existing);
                    await sleep(150);
                } catch (err) {
                    console.error(`[PlaceBlocks] Failed to clear ${existing.name}: ${err.message}`);
                    return { placed: false, reason: `Could not clear ${existing.name} at (${pos.x}, ${pos.y}, ${pos.z})` };
                }
            } else {
                return { placed: false, reason: `Block already at (${pos.x}, ${pos.y}, ${pos.z}): ${existing.name}` };
            }
        }

        // If the bot is standing on/in the target position, step away first
        const botPos = bot.entity.position;
        const botBlockX = Math.floor(botPos.x);
        const botBlockZ = Math.floor(botPos.z);
        const botBlockY = Math.floor(botPos.y);

        if (botBlockX === pos.x && botBlockZ === pos.z &&
            (botBlockY === pos.y || botBlockY - 1 === pos.y)) {
            console.error(`[PlaceBlocks] Bot is on target (${pos.x}, ${pos.y}, ${pos.z}) — stepping away`);
            const mcData = require('minecraft-data')(bot.version);
            bot.pathfinder.setMovements(new Movements(bot, mcData));
            // Move 2 blocks away in a clear direction
            const awayGoal = new goals.GoalNear(pos.x + 2, pos.y, pos.z + 2, 1);
            try {
                await bot.pathfinder.goto(awayGoal);
                await sleep(300);
            } catch (e) {
                // Try opposite direction
                try {
                    const awayGoal2 = new goals.GoalNear(pos.x - 2, pos.y, pos.z - 2, 1);
                    await bot.pathfinder.goto(awayGoal2);
                    await sleep(300);
                } catch (e2) {
                    console.error(`[PlaceBlocks] Could not step away: ${e2.message}`);
                }
            }
        }

        await equipBlock(blockName);
        await moveNear(pos);

        const faces = [
            { dir: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
            { dir: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) },
            { dir: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
            { dir: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
            { dir: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
            { dir: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
        ];

        for (const { dir, face } of faces) {
            const refPos = pos.plus(dir);
            const refBlock = bot.blockAt(refPos);
            if (refBlock && refBlock.name !== 'air' && refBlock.name !== 'cave_air' && refBlock.name !== 'void_air') {
                try {
                    await equipBlock(blockName);
                    await bot.placeBlock(refBlock, face);
                    await sleep(100);
                    return { placed: true };
                } catch (err) {
                    console.error(`[PlaceBlocks] Failed placing against ${refBlock.name}: ${err.message}`);
                }
            }
        }

        return { placed: false, reason: `No adjacent solid block at (${pos.x}, ${pos.y}, ${pos.z}) to place against` };
    }

    // ─── House Blueprints ─────────────────────────────────────────────
    //
    // Each position is { dx, dy, dz, role } relative to the build origin.
    //   role: 'floor' | 'wall' | 'roof' | 'door_frame'
    //
    // The door opening is left EMPTY (those positions are simply not in the list).

    function generateHouseBlueprint(w, h, l) {
        const positions = [];

        // Floor (y=0)
        for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < l; dz++) {
                positions.push({ dx, dy: 0, dz, role: 'floor' });
            }
        }

        // Walls (y=1 to y=h-2, only edges of x/z)
        const wallTop = h - 2; // last wall row before roof
        const doorX = Math.floor(w / 2);

        for (let dy = 1; dy <= wallTop; dy++) {
            for (let dx = 0; dx < w; dx++) {
                for (let dz = 0; dz < l; dz++) {
                    const onEdgeX = (dx === 0 || dx === w - 1);
                    const onEdgeZ = (dz === 0 || dz === l - 1);
                    if (!onEdgeX && !onEdgeZ) continue; // interior air

                    // Door hole: 1-wide × 2-tall on the south wall (+Z face), centered
                    if (dz === l - 1 && dx === doorX && dy <= 2) {
                        continue; // leave empty for door
                    }

                    // Door frame blocks (the blocks around the door hole)
                    const isDoorFrame =
                        (dz === l - 1) &&
                        ((dx === doorX - 1 && dy <= 2) ||
                            (dx === doorX + 1 && dy <= 2) ||
                            (dx === doorX && dy === 3));

                    positions.push({
                        dx, dy, dz,
                        role: isDoorFrame ? 'door_frame' : 'wall',
                    });
                }
            }
        }

        // Roof (y = h-1)
        const roofY = h - 1;
        for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < l; dz++) {
                positions.push({ dx, dy: roofY, dz, role: 'roof' });
            }
        }

        return positions;
    }

    const BLUEPRINTS = {
        small: { w: 5, h: 5, l: 5, label: '5×5×5 small house' },
        medium: { w: 7, h: 5, l: 7, label: '7×5×7 medium house' },
    };

    // ─── Smart Material Selection ─────────────────────────────────────

    /**
     * Preference lists per role.
     * Checked in order; the first block found in inventory is used.
     * Falls back to ANY available placeable block, then dirt.
     */
    const ROLE_PREFERENCES = {
        floor: [
            'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
            'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
            'cobblestone', 'stone', 'stone_bricks', 'deepslate_bricks',
            'smooth_stone', 'andesite', 'diorite', 'granite',
        ],
        wall: [
            'cobblestone', 'stone', 'stone_bricks', 'deepslate_bricks',
            'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
            'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
            'bricks', 'sandstone', 'smooth_sandstone',
            'andesite', 'diorite', 'granite',
            'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
            'acacia_log', 'dark_oak_log',
        ],
        roof: [
            'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
            'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
            'cobblestone', 'stone', 'stone_bricks',
            'oak_slab', 'spruce_slab', 'birch_slab', 'cobblestone_slab',
        ],
        door_frame: [
            'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
            'acacia_log', 'dark_oak_log', 'stripped_oak_log', 'stripped_spruce_log',
            'cobblestone', 'stone_bricks', 'stone', 'deepslate_bricks',
            'oak_planks', 'spruce_planks', 'birch_planks',
        ],
    };

    /**
     * Select the best available blocks for each role.
     * Returns { materials: { role -> blockName }, totalAvailable, plan[] }
     *
     * Strategy:
     *   1. For each role, walk its preference list and pick the first block we have.
     *   2. If no preferred block is found, pick whichever placeable block we have the most of.
     *   3. Track allocated counts to avoid over-counting the same stack.
     */
    function selectBuildMaterials(positions) {
        const available = getPlaceableBlocks();                   // { blockName: count }
        const allocated = {};                                     // { blockName: countReserved }
        const roleCounts = {};                                    // { role: count }

        // Count how many blocks each role needs
        for (const p of positions) {
            roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
        }

        const materials = {};   // role -> blockName
        const plan = [];        // [{role, block, needed, have}]

        for (const role of Object.keys(roleCounts)) {
            const needed = roleCounts[role];
            let chosen = null;

            // 1. Walk preference list
            const prefs = ROLE_PREFERENCES[role] || ROLE_PREFERENCES['wall'];
            for (const pref of prefs) {
                const remaining = (available[pref] || 0) - (allocated[pref] || 0);
                if (remaining >= needed) {
                    chosen = pref;
                    break;
                }
            }

            // 2. If no single preferred block covers it, pick whatever we have the most of
            if (!chosen) {
                // Try prefs first with partial coverage (we'll mix later in build)
                for (const pref of prefs) {
                    const remaining = (available[pref] || 0) - (allocated[pref] || 0);
                    if (remaining > 0) {
                        chosen = pref;
                        break;
                    }
                }
            }

            // 3. Absolute fallback: any placeable block with remaining count
            if (!chosen) {
                let maxCount = 0;
                for (const [blockName, count] of Object.entries(available)) {
                    const remaining = count - (allocated[blockName] || 0);
                    if (remaining > maxCount) {
                        maxCount = remaining;
                        chosen = blockName;
                    }
                }
            }

            if (chosen) {
                materials[role] = chosen;
                allocated[chosen] = (allocated[chosen] || 0) + needed;
            }

            plan.push({
                role,
                block: chosen || null,
                needed,
                have: chosen ? Math.max(0, (available[chosen] || 0) - ((allocated[chosen] || 0) - needed)) : 0,
            });
        }

        // Total blocks available across all selections
        const totalAvailable = Object.values(available).reduce((s, c) => s + c, 0);

        return { materials, totalAvailable, plan, roleCounts };
    }

    // ─── Auto-Gather Fallback ─────────────────────────────────────────

    /**
     * Ensure we have enough blocks to build.  If not, gather dirt.
     * Returns the block name to use as a universal fallback.
     */
    async function ensureBuildMaterials(totalNeeded) {
        const available = getPlaceableBlocks();
        const totalHave = Object.values(available).reduce((s, c) => s + c, 0);

        if (totalHave >= totalNeeded) {
            console.error(`[PlaceBlocks] Inventory has ${totalHave} placeable blocks, need ${totalNeeded} — sufficient`);
            return null; // no gathering needed
        }

        const deficit = totalNeeded - totalHave;
        console.error(`[PlaceBlocks] Need ${deficit} more blocks. Auto-gathering dirt...`);

        if (!gatherResourceTool) {
            console.error('[PlaceBlocks] No gatherResource tool available, skipping auto-gather');
            return null;
        }

        try {
            const result = await gatherResourceTool.gatherResource('dirt', Math.min(deficit + 10, 128));
            console.error(`[PlaceBlocks] Gathered ${result.collected} dirt blocks (success: ${result.success})`);
        } catch (err) {
            console.error(`[PlaceBlocks] Auto-gather failed: ${err.message}`);
        }

        return 'dirt'; // caller can use dirt as fallback
    }

    // ─── Structure Generators (non-house) ─────────────────────────────

    function cuboidPositions(w, h, l) {
        const positions = [];
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                for (let dz = 0; dz < l; dz++) {
                    positions.push({ dx, dy, dz, role: 'wall' });
                }
            }
        }
        return positions;
    }

    function hollowBoxPositions(w, h, l) {
        const positions = [];
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                for (let dz = 0; dz < l; dz++) {
                    const onEdgeX = (dx === 0 || dx === w - 1);
                    const onEdgeY = (dy === 0 || dy === h - 1);
                    const onEdgeZ = (dz === 0 || dz === l - 1);
                    if (onEdgeX || onEdgeY || onEdgeZ) {
                        positions.push({ dx, dy, dz, role: 'wall' });
                    }
                }
            }
        }
        return positions;
    }

    function wallPositions(w, h) {
        const positions = [];
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                positions.push({ dx, dy, dz: 0, role: 'wall' });
            }
        }
        return positions;
    }

    function floorPositions(w, l) {
        const positions = [];
        for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < l; dz++) {
                positions.push({ dx, dy: 0, dz, role: 'floor' });
            }
        }
        return positions;
    }

    // ─── Build Engine ─────────────────────────────────────────────────

    /**
     * Build by placing blocks at every position.
     * `materials` maps role → blockName.
     * `fallbackBlock` is used when a role has no assigned material.
     */
    async function buildFromPositions(positions, materials, origin, fallbackBlock) {
        let placed = 0;
        let skipped = 0;
        let failed = 0;
        const errors = [];

        // Sort bottom-up for support
        positions.sort((a, b) => a.dy - b.dy || a.dx - b.dx || a.dz - b.dz);

        const total = positions.length;
        console.error(`[PlaceBlocks] Building ${total} blocks at (${origin.x}, ${origin.y}, ${origin.z})`);
        console.error(`[PlaceBlocks] Materials: ${JSON.stringify(materials)}`);

        for (let i = 0; i < positions.length; i++) {
            const { dx, dy, dz, role } = positions[i];
            const x = origin.x + dx;
            const y = origin.y + dy;
            const z = origin.z + dz;

            // Determine which block to use for this position
            let blockName = materials[role] || fallbackBlock || 'dirt';

            // If we ran out of the chosen block, try any available block
            if (getItemCount(blockName) === 0) {
                const available = getPlaceableBlocks();
                const alt = Object.entries(available).find(([_, count]) => count > 0);
                if (alt) {
                    blockName = alt[0];
                } else {
                    errors.push(`Ran out of all blocks at position ${i + 1}/${total}`);
                    failed++;
                    continue;
                }
            }

            try {
                const result = await placeSingleBlock(blockName, x, y, z);
                if (result.placed) {
                    placed++;
                } else {
                    skipped++;
                    if (result.reason && !result.reason.includes('Block already at')) {
                        errors.push(result.reason);
                    }
                }
            } catch (err) {
                failed++;
                errors.push(`(${x},${y},${z}): ${err.message}`);
            }

            if ((i + 1) % 10 === 0) {
                console.error(`[PlaceBlocks] Progress: ${i + 1}/${total} (placed: ${placed}, skipped: ${skipped}, failed: ${failed})`);
            }

            await sleep(50);
        }

        const uniqueErrors = [...new Set(errors)].slice(0, 5);
        return {
            success: failed === 0,
            message: `Build complete: ${placed} placed, ${skipped} skipped, ${failed} failed out of ${total}`,
            placed,
            skipped,
            failed,
            total,
            materialsUsed: materials,
            errors: uniqueErrors.length > 0 ? uniqueErrors : undefined,
        };
    }

    // ─── Public API ───────────────────────────────────────────────────

    /**
     * Place a single block (unchanged — the LLM specifies the block and coords)
     */
    async function placeBlock(blockName, x, y, z) {
        try {
            // Resolve (0,0,0) to near bot
            if (x === 0 && y === 0 && z === 0) {
                const origin = resolveBuildOrigin();
                x = origin.x; y = origin.y; z = origin.z;
            } else {
                x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
            }

            const result = await placeSingleBlock(blockName, x, y, z);
            if (result.placed) {
                return { success: true, message: `Placed ${blockName} at (${x}, ${y}, ${z})` };
            } else {
                return { success: false, message: result.reason };
            }
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    /**
     * Build a structure smartly.
     *
     * @param {string} type     - "house", "wall", "floor", "platform", "box", "hollow_box"
     * @param {string} [size]   - For houses: "small" (default) or "medium"
     * @param {number} [width]  - For non-house types
     * @param {number} [height] - For non-house types
     * @param {number} [length] - For non-house types (defaults to width)
     */
    async function buildStructure(type, size, width, height, length) {
        const origin = resolveBuildOrigin();
        let positions;
        let structureLabel;

        switch (type) {
            case 'house': {
                const preset = BLUEPRINTS[size] || BLUEPRINTS['small'];
                positions = generateHouseBlueprint(preset.w, preset.h, preset.l);
                structureLabel = preset.label;
                break;
            }
            case 'wall': {
                const w = width || 5;
                const h = height || 3;
                positions = wallPositions(w, h);
                structureLabel = `${w}×${h} wall`;
                break;
            }
            case 'floor':
            case 'platform': {
                const w = width || 5;
                const l = length || w;
                positions = floorPositions(w, l);
                structureLabel = `${w}×${l} floor`;
                break;
            }
            case 'box': {
                const w = width || 5;
                const h = height || 3;
                const l = length || w;
                positions = cuboidPositions(w, h, l);
                structureLabel = `${w}×${h}×${l} solid box`;
                break;
            }
            case 'hollow_box': {
                const w = width || 5;
                const h = height || 3;
                const l = length || w;
                positions = hollowBoxPositions(w, h, l);
                structureLabel = `${w}×${h}×${l} hollow box`;
                break;
            }
            default:
                return {
                    success: false,
                    message: `Unknown structure type: ${type}. Use: house, wall, floor, platform, box, hollow_box`,
                };
        }

        const totalNeeded = positions.length;
        console.error(`[PlaceBlocks] Planning ${structureLabel}: ${totalNeeded} blocks needed`);

        // Phase 1: Ensure we have enough materials (auto-gather dirt if needed)
        const fallbackBlock = await ensureBuildMaterials(totalNeeded);

        // Phase 2: Select best materials per role from inventory
        const { materials, plan } = selectBuildMaterials(positions);

        console.error(`[PlaceBlocks] Material plan:`);
        for (const p of plan) {
            console.error(`  ${p.role}: ${p.block || 'NONE'} (need ${p.needed}, have ~${p.have})`);
        }

        // Phase 3: Build
        console.error(`[PlaceBlocks] Starting build: ${structureLabel} at (${origin.x}, ${origin.y}, ${origin.z})`);
        const result = await buildFromPositions(positions, materials, origin, fallbackBlock);
        result.structure = structureLabel;
        return result;
    }

    return {
        placeBlock,
        buildStructure,
    };
};
