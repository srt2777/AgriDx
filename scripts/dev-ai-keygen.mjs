import { randomBytes } from 'node:crypto';

// Terminal only: do not persist the wrapping key in the checkout or build outputs.
console.log('请将下面的随机值作为 Sites 运行时 secret DEV_AI_ENCRYPTION_KEY 保存：');
console.log(randomBytes(32).toString('hex'));
console.log('丢失后需重新输入所有服务商密钥；请妥善保存。');
