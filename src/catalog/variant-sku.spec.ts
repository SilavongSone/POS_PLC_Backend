import { describe, expect, it } from 'vitest';
import { variantSku } from './product-groups.service.js';

describe('variantSku', () => {
  it('swaps only the part that differs', () => {
    expect(variantSku('XPR-T80Q-USB-WIFI', 'USB+WiFi', 'USB+LAN')).toBe(
      'XPR-T80Q-USB-LAN',
    );
  });

  it('ignores the model repeated in the value', () => {
    expect(
      variantSku(
        'XPR-T80Q-USB-WIFI',
        'XP-T80Q USB+WIFI',
        'XP-T80Q USB+Bluetooth',
      ),
    ).toBe('XPR-T80Q-USB-BLUETOOTH');
  });

  it('appends only new words when the SKU has no value part', () => {
    expect(variantSku('XP-T80Q', 'USB+WiFi', 'USB+LAN')).toBe(
      'XP-T80Q-USB-LAN',
    );
    expect(variantSku('XP-T80Q-USB', 'USB', 'USB+LAN')).toBe('XP-T80Q-USB-LAN');
  });

  it('works for sizes', () => {
    expect(variantSku('PAPER-80', '80mm', '58mm')).toBe('PAPER-80-58MM');
    expect(variantSku('PAPER-80MM', '80mm', '58mm')).toBe('PAPER-58MM');
  });
});
