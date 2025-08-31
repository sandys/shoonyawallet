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
}

