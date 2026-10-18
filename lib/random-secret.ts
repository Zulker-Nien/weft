// A random value for the 🔐 vault's form (components/SecretValueField.tsx): a CRON_SECRET, a signing
// secret, a password. Letters and digits only, so it needs no quoting in a .env file, a shell or a URL;
// 40 of them is about 238 bits. Bytes from 248 up are dropped so every character is equally likely.
export const SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const CUTOFF = 256 - (256 % SECRET_ALPHABET.length);

export function randomSecret(length = 40, fill: (bytes: Uint8Array) => void = (b) => crypto.getRandomValues(b)): string {
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    fill(bytes);
    for (const byte of bytes) {
      if (byte < CUTOFF && out.length < length) out += SECRET_ALPHABET.charAt(byte % SECRET_ALPHABET.length);
    }
  }
  return out;
}
