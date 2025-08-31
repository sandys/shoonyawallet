import { pickRPC } from '../src/services/rpc/rpcConfig';

describe('rpc config', () => {
  it('round-robins across configured urls', () => {
    const a = pickRPC();
    const b = pickRPC();
    expect(a).not.toEqual('');
    expect(b).not.toEqual('');
  });
});

