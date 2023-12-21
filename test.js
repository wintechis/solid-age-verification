const CryptoJS = require('crypto-js');

function encrypt(message, key) {
  const cipher = CryptoJS.enc.Utf8.parse(message);
  const encrypted = CryptoJS.AES.encrypt(cipher, key);
  return encrypted.toString();
}

function decrypt(ciphertext, key) {
  const decrypted = CryptoJS.AES.decrypt(ciphertext, key);
  return decrypted.toString(CryptoJS.enc.Utf8);
}

const message = '10-20-1998';
const key = 'UHZdlkjetGlrkjter5487dtettGterjhkskdfhwkerweLokijhGF';

const encryptedMessage = encrypt(message, key);
console.log('Encrypted message:', encryptedMessage);
let en = 'U2FsdGVkX19qU0clDLD5hqO86Sw2flQUmxE5on683Vw=';
const decryptedMessage = decrypt(en, key);
console.log('Decrypted message:', decryptedMessage);