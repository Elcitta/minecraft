/**
 * Smart Gather Resource Tool
 * Autonomously mines blocks using smart heuristics for block selection.
 * Falls back to LLM (Groq) when heuristics can't find reachable blocks.
 */
const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { askLLM } = require('./llmHelper');

module.exports = function gatherResource(bot) {
    console.error('[GatherResource] Smart tool loaded');

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get count of specific item in inventory
     */
    function getItemCount(itemName) {
        const items = bot.inventory.items().filter(item => item.name === itemName);
        return items.reduce((sum, item) => sum + item.count, 0);
    }

    /**
     * Check if inventory has space
     */
    function hasInventorySpace() {
        return bot.inventory.emptySlotCount() > 0;
    }

    /**
     * Equip best tool for mining the block
     */
    async function equipBestTool(block) {
        try {
            const mcData = require('minecraft-data')(bot.version);
            const availableTools = bot.inventory.items().filter(item => {
                return item.name.includes('pickaxe') ||
                    item.name.includes('axe') ||
                    item.name.includes('shovel') ||
                    item.name.includes('hoe');
            });

            if (availableTools.length === 0) return;

            const toolPriority = ['diamond', 'iron', 'stone', 'wooden', 'golden'];
            availableTools.sort((a, b) => {
                const aPriority = toolPriority.findIndex(mat => a.name.includes(mat));
                const bPriority = toolPriority.findIndex(mat => b.name.includes(mat));
                return (aPriority === -1 ? 999 : aPriority) - (bPriority === -1 ? 999 : bPriority);
            });

            const bestTool = availableTools[0];
            if (bot.heldItem?.name !== bestTool.name) {
                await bot.equip(bestTool, 'hand');
                console.error(`[GatherResource] Equipped ${bestTool.name}`);
            }
        } catch (error) {
            console.error(`[GatherResource] Error equipping tool: ${error.message}`);
        }
    }

    /**
     * Collect nearby dropped items
     */
    async function collectNearbyDrops(resourceName, maxDistance = 12) {
        try {
            const mcData = require('minecraft-data')(bot.version);
            const droppedItems = Object.values(bot.entities)
                .filter(entity => {
                    if (entity.name !== 'item') return false;
                    return entity.position.distanceTo(bot.entity.position) <= maxDistance;
                })
                .sort((a, b) =>
                    a.position.distanceTo(bot.entity.position) -
                    b.position.distanceTo(bot.entity.position)
                );

            for (const item of droppedItems) {
                try {
                    const distance = item.position.distanceTo(bot.entity.position);
                    if (distance > 2) {
                        bot.pathfinder.setMovements(new Movements(bot, mcData));
                        bot.pathfinder.setGoal(
                            new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1)
                        );
                        await sleep(500);
                    }
                } catch (error) {
                    continue;
                }
            }
            await sleep(300);
        } catch (error) {
            console.error(`[GatherResource] Error collecting drops: ${error.message}`);
        }
    }

    // ─── Layer 1: Smart Heuristics ────────────────────────────────────

    /**
     * Check if a block position is "air-like" (air, cave_air, void_air, or vegetation)
     */
    function isAirLike(pos) {
        const block = bot.blockAt(pos);
        if (!block) return true;
        const airish = new Set([
            'air', 'cave_air', 'void_air',
            'grass', 'short_grass', 'tall_grass', 'fern', 'large_fern',
            'dead_bush', 'dandelion', 'poppy', 'blue_orchid', 'allium',
            'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
            'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
            'sunflower', 'lilac', 'rose_bush', 'peony', 'snow', 'vine',
        ]);
        return airish.has(block.name);
    }

    /**
     * Find a block using smart heuristics:
     *   1. Y must be between startingY and startingY + 2 (surface level)
     *   2. Must have air-like block above it (exposed / reachable)
     *   3. Prefers closer blocks
     */
    function findSmartBlock(blockTypeId, range, startingY) {
        const block = bot.findBlock({
            matching: blockTypeId,
            maxDistance: range,
            useExtraInfo: (block) => {
                const by = block.position.y;

                // Rule 1: Stay within surface band
                if (by < startingY || by > startingY + 2) {
                    return false;
                }

                // Rule 2: Must have air above (bot can reach it without scaffolding)
                const above = new Vec3(block.position.x, by + 1, block.position.z);
                if (!isAirLike(above)) {
                    return false;
                }

                return true;
            }
        });
        return block;
    }

    // ─── Layer 2: LLM Fallback ────────────────────────────────────────

    /**
     * When heuristics find nothing, scan all candidate blocks and ask the LLM
     * which one is safest to mine.
     *
     * Returns the selected block, or null if LLM is unavailable / fails.
     */
    async function findBlockWithLLM(blockTypeId, range, startingY) {
        console.error('[GatherResource] Heuristics found nothing — activating LLM fallback');

        // Get ALL matching blocks within range (above startingY)
        const candidates = bot.findBlocks({
            matching: blockTypeId,
            maxDistance: range,
            count: 20, // top 20 nearest
            useExtraInfo: (block) => block.position.y >= startingY,
        });

        if (candidates.length === 0) {
            console.error('[GatherResource] LLM fallback: no candidate blocks at all');
            return null;
        }

        // Build context for each candidate
        const botPos = bot.entity.position;
        const candidateDescriptions = candidates.map((pos, i) => {
            const blockAbove = bot.blockAt(new Vec3(pos.x, pos.y + 1, pos.z));
            const blockBelow = bot.blockAt(new Vec3(pos.x, pos.y - 1, pos.z));
            const aboveName = blockAbove ? blockAbove.name : 'unknown';
            const belowName = blockBelow ? blockBelow.name : 'unknown';
            const dist = Math.floor(botPos.distanceTo(new Vec3(pos.x, pos.y, pos.z)));
            const heightDiff = pos.y - Math.floor(botPos.y);

            return `${String.fromCharCode(65 + i)}: (${pos.x}, ${pos.y}, ${pos.z}) — ` +
                `${dist} blocks away, ${heightDiff >= 0 ? '+' : ''}${heightDiff}Y from you, ` +
                `above: ${aboveName}, below: ${belowName}`;
        });

        const systemPrompt =
            'You are a Minecraft bot picking which block to mine next. ' +
            'Pick the SAFEST block that can be reached by WALKING — no climbing or scaffolding. ' +
            'Prefer blocks at ground level with air above them. ' +
            'Avoid blocks high up on structures or underground. ' +
            'Reply with ONLY the letter (A, B, C, etc.) of your choice, nothing else.';

        const userPrompt =
            `Your position: (${Math.floor(botPos.x)}, ${Math.floor(botPos.y)}, ${Math.floor(botPos.z)})\n` +
            `Ground level Y: ${startingY}\n\n` +
            `Candidate blocks:\n${candidateDescriptions.join('\n')}\n\n` +
            `Which block should I mine? Reply with just the letter.`;

        console.error(`[GatherResource] LLM prompt:\n${userPrompt}`);

        const response = await askLLM(systemPrompt, userPrompt);
        if (!response) {
            console.error('[GatherResource] LLM returned no response, picking first candidate');
            return bot.blockAt(new Vec3(candidates[0].x, candidates[0].y, candidates[0].z));
        }

        // Parse the letter from the response
        const letter = response.trim().toUpperCase().charAt(0);
        const index = letter.charCodeAt(0) - 65; // A=0, B=1, ...

        if (index >= 0 && index < candidates.length) {
            const chosen = candidates[index];
            console.error(`[GatherResource] LLM chose ${letter}: (${chosen.x}, ${chosen.y}, ${chosen.z})`);
            return bot.blockAt(new Vec3(chosen.x, chosen.y, chosen.z));
        }

        console.error(`[GatherResource] LLM gave invalid letter "${letter}", using first candidate`);
        return bot.blockAt(new Vec3(candidates[0].x, candidates[0].y, candidates[0].z));
    }

    // ─── Main Gathering Loop ──────────────────────────────────────────

    async function gatherResource(resource, amount, range = 64) {
        try {
            if (!resource || typeof resource !== 'string') {
                throw new Error('Invalid resource name');
            }
            if (!amount || amount <= 0) {
                throw new Error('Amount must be greater than 0');
            }
            if (range <= 0 || range > 128) {
                throw new Error('Range must be between 1 and 128');
            }

            const mcData = require('minecraft-data')(bot.version);
            const blockType = mcData.blocksByName[resource];

            if (!blockType) {
                throw new Error(`Unknown block type: ${resource}`);
            }

            console.error(`[GatherResource] Starting to gather ${amount}x ${resource} within ${range} blocks`);

            const startingCount = getItemCount(resource);
            let iterationCount = 0;
            const maxIterations = 100;

            // Lock starting Y — never mine below this
            const startingY = Math.floor(bot.entity.position.y) - 1;
            console.error(`[GatherResource] Floor Y locked at ${startingY}`);

            let llmFallbackCount = 0;

            // Main gathering loop
            while (getItemCount(resource) - startingCount < amount) {
                iterationCount++;

                if (iterationCount > maxIterations) {
                    const collected = getItemCount(resource) - startingCount;
                    return {
                        success: false,
                        message: `Reached max iteration limit. Collected ${collected}/${amount} ${resource}.`,
                        collected,
                        resource
                    };
                }

                if (!hasInventorySpace()) {
                    const collected = getItemCount(resource) - startingCount;
                    return {
                        success: false,
                        message: 'Inventory full.',
                        collected,
                        resource
                    };
                }

                // ── Layer 1: Smart heuristic search ──
                let block = findSmartBlock(blockType.id, range, startingY);

                // ── Layer 2: LLM fallback when stuck ──
                if (!block) {
                    block = await findBlockWithLLM(blockType.id, range, startingY);
                    if (block) {
                        llmFallbackCount++;
                        console.error(`[GatherResource] LLM fallback used (total: ${llmFallbackCount})`);
                    }
                }

                if (!block) {
                    const collected = getItemCount(resource) - startingCount;
                    return {
                        success: false,
                        message: `No more reachable ${resource} blocks found within ${range} blocks.`,
                        collected,
                        resource
                    };
                }

                console.error(`[GatherResource] Target: ${resource} at (${block.position.x}, ${block.position.y}, ${block.position.z})`);

                await equipBestTool(block);

                // Move to the block
                try {
                    bot.pathfinder.setMovements(new Movements(bot, mcData));
                    const goal = new goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z);
                    await bot.pathfinder.goto(goal);
                } catch (pathError) {
                    console.error(`[GatherResource] Pathfinding failed: ${pathError.message}`);
                    await sleep(500);
                    continue;
                }

                await sleep(100);

                // Verify block still exists
                const targetBlock = bot.blockAt(block.position);
                if (!targetBlock || targetBlock.type !== blockType.id) {
                    console.error(`[GatherResource] Block disappeared or changed`);
                    continue;
                }

                // Dig
                try {
                    console.error(`[GatherResource] Mining ${resource}...`);
                    await bot.dig(targetBlock);
                    console.error(`[GatherResource] Mined successfully`);
                    await sleep(200);
                    await collectNearbyDrops(resource);
                    await sleep(300);
                } catch (digError) {
                    console.error(`[GatherResource] Failed to dig: ${digError.message}`);
                    await sleep(500);
                    continue;
                }

                const currentCount = getItemCount(resource) - startingCount;
                console.error(`[GatherResource] Progress: ${currentCount}/${amount}`);
            }

            const finalCollected = getItemCount(resource) - startingCount;
            console.error(`[GatherResource] Done! Gathered ${finalCollected}x ${resource} (LLM fallbacks used: ${llmFallbackCount})`);

            return {
                success: true,
                collected: finalCollected,
                resource
            };

        } catch (error) {
            console.error(`[GatherResource] Error: ${error.message}`);
            return {
                success: false,
                message: error.message,
                collected: 0,
                resource
            };
        }
    }

    return {
        gatherResource
    };
};
