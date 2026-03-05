#!/usr/bin/env node
require('dotenv').config();

/**
 * Minecraft Bot MCP Server
 * Exposes Minecraft bot capabilities as MCP tools for LLM interaction
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const bot = require('./bot');

// Import tool modules
const autoEquip = require('./tools/autoEquip');
const guard = require('./tools/guard');
const selfDefense = require('./tools/selfDefense');
const gatherResource = require('./tools/gatherResource');
const giveItem = require('./tools/giveItem');
const selfSustain = require('./tools/selfSustain');
const placeBlocks = require('./tools/placeBlocks');

// Initialize bot tools
console.error('Initializing Minecraft bot tools...');
autoEquip(bot);
selfSustain(bot);
const guardTool = guard(bot);
const selfDefenseTool = selfDefense(bot);
const gatherResourceTool = gatherResource(bot);
const giveItemTool = giveItem(bot);
const placeBlocksTool = placeBlocks(bot, gatherResourceTool);


// Create MCP server
const server = new Server(
  {
    name: 'minecraft-bot-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define MCP tools
const tools = [
  {
    name: 'minecraft_guard_position',
    description: 'START continuous guarding mode (runs until stopped). Two modes: Position mode - guard static coordinates and attack nearby mobs. Player mode - actively follow and protect a specific player, attacking anyone within 8 blocks. This is a persistent action that continues indefinitely. Keywords: guard, protect, defend, bodyguard, follow, watch over.',
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate to guard (only for position mode - do not use with player)',
        },
        y: {
          type: 'number',
          description: 'Y coordinate to guard (only for position mode - do not use with player)',
        },
        z: {
          type: 'number',
          description: 'Z coordinate to guard (only for position mode - do not use with player)',
        },
        player: {
          type: 'string',
          description: 'Player username to actively follow and protect (only for player mode - do not use with x/y/z)',
        },
      },
    },
  },
  {
    name: 'minecraft_stop_guarding',
    description: 'STOP continuous guarding mode. Cancels any active guard position or player protection. The bot will cease all guarding activities immediately. Keywords: stop guarding, stop protecting, cancel guard, stand down.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'minecraft_get_status',
    description: 'Get the current status of the bot including health, hunger, position, and equipment.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'minecraft_chat',
    description: 'Send a chat message in the Minecraft server as the bot.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to send in chat',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'minecraft_move_to',
    description: 'Move the bot to a specific position using pathfinding.',
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate to move to',
        },
        y: {
          type: 'number',
          description: 'Y coordinate to move to',
        },
        z: {
          type: 'number',
          description: 'Z coordinate to move to',
        },
      },
      required: ['x', 'y', 'z'],
    },
  },
  {
    name: 'minecraft_attack_entity',
    description: 'Attack a nearby entity by name or type. Use "player" or "nearest player" to attack the closest player, or specify a username/mob type.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: {
          type: 'string',
          description: 'Name of the entity to attack (e.g., "zombie", "skeleton", "player", "nearest player", or a specific player username)',
        },
      },
      required: ['entityName'],
    },
  },
  {
    name: 'minecraft_get_nearby_entities',
    description: 'Get a list of all nearby entities (players, mobs, items) within a specified range.',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'number',
          description: 'Range in blocks to search for entities (default: 16)',
          default: 16,
        },
        type: {
          type: 'string',
          description: 'Filter by entity type: "player", "mob", or "item" (optional)',
        },
      },
    },
  },
  {
    name: 'minecraft_get_inventory',
    description: 'Get the current inventory contents of the bot.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'minecraft_equip_item',
    description: 'Equip a specific item from inventory to hand or off-hand.',
    inputSchema: {
      type: 'object',
      properties: {
        itemName: {
          type: 'string',
          description: 'Name of the item to equip (e.g., "diamond_sword", "shield")',
        },
        slot: {
          type: 'string',
          description: 'Where to equip: "hand" or "off-hand"',
          enum: ['hand', 'off-hand'],
        },
      },
      required: ['itemName', 'slot'],
    },
  },
  {
    name: 'minecraft_gather_resource',
    description: 'Autonomously mine and gather a specific block resource until the requested amount is collected. The bot will continuously search for blocks, pathfind to them, mine them, and collect drops. Automatically equips best available tool. Stops when target amount is reached or no more blocks are found. Optionally give collected items to a player. Keywords: mine, gather, collect, harvest, farm blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          description: 'Block resource to gather (e.g., "oak_log", "cobblestone", "iron_ore", "dirt")',
        },
        amount: {
          type: 'number',
          description: 'Target number of items to collect',
        },
        range: {
          type: 'number',
          description: 'Maximum search range in blocks (default: 64, max: 128)',
          default: 64,
        },
        giveToPlayer: {
          type: 'string',
          description: 'Optional: Player username to give the collected items to after gathering completes',
        },
      },
      required: ['resource', 'amount'],
    },
  },
  {
    name: 'minecraft_give_item',
    description: 'Give items from bot inventory to a nearby player by tossing them. The player must be online, visible, and within 32 blocks. Items are tossed towards the player for them to pick up. Keywords: give, toss, throw, donate, transfer items.',
    inputSchema: {
      type: 'object',
      properties: {
        player: {
          type: 'string',
          description: 'Username of the player to give items to',
        },
        item: {
          type: 'string',
          description: 'Name of the item to give (e.g., "oak_log", "diamond", "iron_ingot")',
        },
        amount: {
          type: 'number',
          description: 'Number of items to give',
        },
      },
      required: ['player', 'item', 'amount'],
    },
  },
  {
    name: 'minecraft_place_block',
    description: 'Place a single block at the specified coordinates. The block must be in the bot inventory. Keywords: place, put, set block.',
    inputSchema: {
      type: 'object',
      properties: {
        block: {
          type: 'string',
          description: 'Block name to place (e.g., "cobblestone", "oak_planks", "stone_bricks")',
        },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        z: { type: 'number', description: 'Z coordinate' },
      },
      required: ['block', 'x', 'y', 'z'],
    },
  },
  {
    name: 'minecraft_build_structure',
    description: 'Build a structure near the bot. The bot automatically picks the best blocks from inventory (e.g. planks for floors, cobblestone for walls) and will gather dirt if not enough materials are available. For houses, pre-built blueprints are used so no dimensions are needed. Supported types: "house" (4 walls + floor + roof with a door), "wall", "floor"/"platform", "box" (solid), "hollow_box". Keywords: build, construct, create, house, wall, floor, platform, shelter, base.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Structure type to build',
          enum: ['house', 'wall', 'floor', 'platform', 'box', 'hollow_box'],
        },
        size: {
          type: 'string',
          description: 'Size preset for houses: "small" (5×5×5, default) or "medium" (7×5×7). Ignored for other types.',
          enum: ['small', 'medium'],
        },
        width: {
          type: 'number',
          description: 'Width in blocks (only for wall/floor/box types, not needed for house). Defaults to 5.',
        },
        height: {
          type: 'number',
          description: 'Height in blocks (only for wall/box types, not needed for house). Defaults to 3.',
        },
        length: {
          type: 'number',
          description: 'Length in blocks (only for floor/box types). Defaults to same as width.',
        },
      },
      required: ['type'],
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'minecraft_guard_position': {
        // Player protection mode takes priority
        if (args.player && args.player.trim() !== '') {
          const player = bot.players[args.player];
          if (!player || !player.entity) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Player "${args.player}" not found or not visible. Make sure they are online and nearby.`,
                },
              ],
            };
          }
          guardTool.guardPlayer(args.player);
          return {
            content: [
              {
                type: 'text',
                text: `🛡️ Now actively protecting ${args.player}. I will follow them continuously and attack any threats within 8 blocks. Use 'stop_guarding' to cancel.`,
              },
            ],
          };
        } else if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
          const pos = { x: args.x, y: args.y, z: args.z, clone: () => ({ x: args.x, y: args.y, z: args.z }) };
          guardTool.guardArea(pos);
          return {
            content: [
              {
                type: 'text',
                text: `🏰 Now guarding position (${args.x}, ${args.y}, ${args.z}). I will patrol and attack nearby hostile mobs. Use 'stop_guarding' to cancel.`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: 'Please provide either coordinates (x, y, z) OR a player name (not both).',
              },
            ],
          };
        }
      }

      case 'minecraft_stop_guarding': {
        guardTool.stopGuarding();
        return {
          content: [
            {
              type: 'text',
              text: 'Stopped guarding.',
            },
          ],
        };
      }

      case 'minecraft_get_status': {
        const pos = bot.entity.position;
        const inventory = bot.inventory.items().map(item => `${item.name} x${item.count}`);
        const equipped = {
          hand: bot.heldItem ? bot.heldItem.name : 'empty',
          offHand: bot.inventory.slots[45] ? bot.inventory.slots[45].name : 'empty',
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                health: bot.health,
                food: bot.food,
                position: { x: pos.x, y: pos.y, z: pos.z },
                equipped,
                inventory: inventory.slice(0, 10), // Limit to first 10 items
                totalItems: inventory.length,
              }, null, 2),
            },
          ],
        };
      }

      case 'minecraft_chat': {
        bot.chat(args.message);
        return {
          content: [
            {
              type: 'text',
              text: `Sent message: "${args.message}"`,
            },
          ],
        };
      }

      case 'minecraft_move_to': {
        const { Movements, goals } = require('mineflayer-pathfinder');
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot, mcData));
        bot.pathfinder.setGoal(new goals.GoalBlock(args.x, args.y, args.z));

        return {
          content: [
            {
              type: 'text',
              text: `Moving to position (${args.x}, ${args.y}, ${args.z})`,
            },
          ],
        };
      }

      case 'minecraft_attack_entity': {
        let entity;

        // Special handling for "nearest/closest player/mob" commands
        const searchTerm = args.entityName.toLowerCase();
        if (searchTerm.includes('nearest') || searchTerm.includes('closest') ||
          searchTerm === 'player' || searchTerm === 'any player') {
          // Find nearest player
          entity = bot.nearestEntity(e => e.type === 'player');
        } else if (searchTerm === 'mob' || searchTerm === 'any mob' ||
          searchTerm.includes('nearest mob') || searchTerm.includes('closest mob')) {
          // Find nearest mob
          entity = bot.nearestEntity(e => e.type === 'mob');
        } else {
          // Normal name search
          entity = bot.nearestEntity(e => {
            if (e.type === 'player') {
              return e.username && e.username.toLowerCase().includes(searchTerm);
            } else if (e.type === 'mob') {
              return e.name && e.name.toLowerCase().includes(searchTerm);
            }
            return false;
          });
        }

        if (!entity) {
          return {
            content: [
              {
                type: 'text',
                text: `No entity found matching "${args.entityName}"`,
              },
            ],
          };
        }

        bot.pvp.attack(entity);
        return {
          content: [
            {
              type: 'text',
              text: `Attacking ${entity.name || entity.username}`,
            },
          ],
        };
      }

      case 'minecraft_get_nearby_entities': {
        const range = args.range || 16;
        const entities = Object.values(bot.entities).filter(e => {
          if (e === bot.entity) return false;
          const distance = e.position.distanceTo(bot.entity.position);
          if (distance > range) return false;

          if (args.type) {
            return e.type === args.type;
          }
          return true;
        }).map(e => ({
          type: e.type,
          name: e.name || e.username || 'unknown',
          position: { x: Math.floor(e.position.x), y: Math.floor(e.position.y), z: Math.floor(e.position.z) },
          distance: e.position.distanceTo(bot.entity.position).toFixed(1),
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(entities, null, 2),
            },
          ],
        };
      }

      case 'minecraft_get_inventory': {
        const items = bot.inventory.items().map(item => ({
          name: item.name,
          count: item.count,
          slot: item.slot,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      }

      case 'minecraft_equip_item': {
        const item = bot.inventory.items().find(i => i.name.includes(args.itemName));

        if (!item) {
          return {
            content: [
              {
                type: 'text',
                text: `Item "${args.itemName}" not found in inventory.`,
              },
            ],
          };
        }

        await bot.equip(item, args.slot);
        return {
          content: [
            {
              type: 'text',
              text: `Equipped ${item.name} to ${args.slot}`,
            },
          ],
        };
      }

      case 'minecraft_gather_resource': {
        const resource = args.resource;
        const amount = args.amount;
        const range = args.range || 64;
        const giveToPlayer = args.giveToPlayer;

        // Validate inputs
        if (!resource || typeof resource !== 'string') {
          return {
            content: [
              {
                type: 'text',
                text: 'Please provide a valid resource name (e.g., "oak_log", "cobblestone").',
              },
            ],
            isError: true,
          };
        }

        if (!amount || amount <= 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'Please provide a valid amount greater than 0.',
              },
            ],
            isError: true,
          };
        }

        // Execute gathering (this is async and will take time)
        const result = await gatherResourceTool.gatherResource(resource, amount, range);

        // If gathering succeeded and giveToPlayer is specified, give the items
        if (result.success && giveToPlayer) {
          const giveResult = await giveItemTool.giveItem(giveToPlayer, resource, result.collected);

          if (giveResult.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: `Successfully gathered ${result.collected}x ${result.resource} and gave ${giveResult.given}x to ${giveToPlayer}`,
                    collected: result.collected,
                    resource: result.resource,
                    given: giveResult.given,
                    givenTo: giveToPlayer,
                  }, null, 2),
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: `Gathered ${result.collected}x ${result.resource} but failed to give to ${giveToPlayer}: ${giveResult.message}`,
                    collected: result.collected,
                    resource: result.resource,
                    giveError: giveResult.message,
                  }, null, 2),
                },
              ],
            };
          }
        }

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `Successfully gathered ${result.collected}x ${result.resource}`,
                  collected: result.collected,
                  resource: result.resource,
                }, null, 2),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: result.message,
                  collected: result.collected,
                  resource: result.resource,
                }, null, 2),
              },
            ],
            isError: result.collected === 0,
          };
        }
      }

      case 'minecraft_give_item': {
        const playerName = args.player;
        const itemName = args.item;
        const amount = args.amount;

        // Validate inputs
        if (!playerName || typeof playerName !== 'string') {
          return {
            content: [
              {
                type: 'text',
                text: 'Please provide a valid player name.',
              },
            ],
            isError: true,
          };
        }

        if (!itemName || typeof itemName !== 'string') {
          return {
            content: [
              {
                type: 'text',
                text: 'Please provide a valid item name.',
              },
            ],
            isError: true,
          };
        }

        if (!amount || amount <= 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'Please provide a valid amount greater than 0.',
              },
            ],
            isError: true,
          };
        }

        // Execute give item
        const result = await giveItemTool.giveItem(playerName, itemName, amount);

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: result.message,
                  given: result.given,
                  player: result.player,
                  item: result.item,
                }, null, 2),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: result.message,
                  given: result.given,
                  player: result.player,
                  item: result.item,
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      case 'minecraft_place_block': {
        const result = await placeBlocksTool.placeBlock(args.block, args.x, args.y, args.z);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      }

      case 'minecraft_build_structure': {
        const result = await placeBlocksTool.buildStructure(
          args.type, args.size, args.width, args.height, args.length
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Minecraft Bot MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
