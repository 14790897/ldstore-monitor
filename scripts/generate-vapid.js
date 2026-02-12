// Generate VAPID key pair using Web Crypto API
async function generateVAPIDKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  // For VAPID, we need the uncompressed public key in URL-safe base64
  // Convert JWK x,y to raw uncompressed format (0x04 || x || y)
  const xBytes = Buffer.from(publicJwk.x, 'base64url');
  const yBytes = Buffer.from(publicJwk.y, 'base64url');
  const uncompressed = Buffer.concat([Buffer.from([0x04]), xBytes, yBytes]);
  const publicKeyBase64url = uncompressed.toString('base64url');

  const dBytes = Buffer.from(privateJwk.d, 'base64url');
  const privateKeyBase64url = dBytes.toString('base64url');

  console.log('VAPID Keys Generated:\n');
  console.log('Public Key:', publicKeyBase64url);
  console.log('Private Key:', privateKeyBase64url);
  console.log('\nNext steps:');
  console.log('1. Put public key in wrangler.toml [vars] VAPID_PUBLIC_KEY');
  console.log('2. Run: npx wrangler secret put VAPID_PRIVATE_KEY');
  console.log('   Then paste the private key above');
}

generateVAPIDKeys().catch(console.error);
