import rpcList from '../../config/rpc.json';

let index = 0;

export function pickRPC(): string {
  const urls = (rpcList?.urls ?? []).filter(Boolean);
  if (!urls.length) return 'https://api.mainnet-beta.solana.com';
  const picked = urls[index % urls.length];
  index++;
  return picked;
}

