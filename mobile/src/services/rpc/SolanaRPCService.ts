import { Connection, PublicKey } from '@solana/web3.js';
import { pickRPC } from '../rpc/rpcConfig';

export class SolanaRPCService {
  private connection: Connection;

  constructor() {
    const endpoint = pickRPC();
    this.connection = new Connection(endpoint, 'confirmed');
  }

  async getBalance(address: string): Promise<number> {
    const key = new PublicKey(address);
    const lamports = await this.connection.getBalance(key, 'confirmed');
    return lamports;
  }

  async getSplTokenBalances(address: string): Promise<Array<{
    mint: string;
    uiAmount: number;
    amount: string;
    decimals: number;
  }>> {
    const owner = new PublicKey(address);
    const TOKEN_PROGRAMS = [
      // SPL Token Program
      new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      // SPL Token 2022
      new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
    ];
    const out: Array<{ mint: string; uiAmount: number; amount: string; decimals: number }> = [];
    for (const programId of TOKEN_PROGRAMS) {
      try {
        const resp = await this.connection.getParsedTokenAccountsByOwner(owner, { programId });
        for (const { account } of resp.value) {
          const data: any = account.data;
          if (data?.program !== 'spl-token') continue;
          const parsed = data?.parsed?.info;
          const mint = parsed?.mint as string | undefined;
          const tokenAmount = parsed?.tokenAmount as any;
          const uiAmount = Number(tokenAmount?.uiAmount ?? 0);
          const amount = String(tokenAmount?.amount ?? '0');
          const decimals = Number(tokenAmount?.decimals ?? 0);
          if (mint && uiAmount > 0) {
            out.push({ mint, uiAmount, amount, decimals });
          }
        }
      } catch (_) {
        // ignore per-program errors
      }
    }
    // Sort by uiAmount descending
    out.sort((a, b) => b.uiAmount - a.uiAmount);
    return out;
  }
}
