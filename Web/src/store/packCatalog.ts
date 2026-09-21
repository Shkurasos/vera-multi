/**
 * Canonical mapping between a pack key and the cosmetic item IDs it owns.
 *
 * The `r-*` family is intentionally kept as-is: these IDs are already stored
 * in user profiles and must remain valid after the catalog expansion.
 */
export interface PackPartIds {
  ring: string;
  selfcard: string;
  bubble: string;
}

export function packKeyFromPackId(packId: string): string | undefined {
  return packId.startsWith('pack-') && packId.length > 5 ? packId.slice(5) : undefined;
}

export function packIdFromKey(packKey: string): string {
  return `pack-${packKey}`;
}

export function packPartIds(packKey: string): PackPartIds {
  if (packKey.startsWith('r-')) {
    return {
      ring: `ring-${packKey}`,
      selfcard: `selfcard-${packKey}`,
      bubble: `bubble-${packKey}`,
    };
  }
  return {
    ring: `ring-pack-${packKey}`,
    selfcard: `selfcard-pack-${packKey}`,
    bubble: `bubble-${packKey}`,
  };
}

/** Resolve any persisted cosmetic item ID to its owning pack key. */
export function packKeyFromItemId(itemId: string): string | undefined {
  const dedicated = itemId.match(/^(?:ring|selfcard)-pack-(.+)$/);
  if (dedicated?.[1]) return dedicated[1];

  const legacyRarity = itemId.match(/^(?:ring|selfcard|bubble)-r-(.+)$/);
  if (legacyRarity?.[1]) return `r-${legacyRarity[1]}`;

  const bubble = itemId.match(/^bubble-(.+)$/);
  return bubble?.[1] || undefined;
}