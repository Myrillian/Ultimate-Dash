import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Schnelle Passwort-Hashes in Tests; der Betrieb nutzt die sicheren Standardwerte.
    env: { SCRYPT_N: '1024' },
  },
});
