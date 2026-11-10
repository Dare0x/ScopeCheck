import { Contract, FetchRequest, JsonRpcProvider, ZeroAddress, id } from 'ethers';
import { ReviewError } from './review.mjs';

const address = '0xc54a0CD2aB480D8124161772db17899c33747c89';
const chain = 421614;
const abi = [
  'function getDeal(uint256 dealId) view returns ((address client,address worker,address arbiter,address token,bytes32 termsCommitment,uint128 totalDeposited,uint128 remaining,uint32 currentMilestone,uint32 milestoneCount,uint32 reviewWindow,uint64 activeSince,uint64 disputedAt,bool closed))',
  'function getMilestones(uint256 dealId) view returns ((uint128 amount,uint64 dueAt,uint64 submittedAt,uint8 status,bytes32 evidenceCommitment)[])',
];

export async function verifyEscrow(binding, releaseUrl, commit) {
  if (binding == null) return null;
  const { dealId, milestone } = binding;
  if (!Number.isSafeInteger(dealId) || dealId < 0 || !Number.isInteger(milestone) || milestone < 1 || milestone > 12) {
    throw new ReviewError('Enter a numeric ScopePay deal and a milestone from 1 to 12.');
  }
  const source = 'https://scopepay-arbitrum.vercel.app/?deal=' + dealId;
  const hold = detail => ({ status: 'hold', detail, source });
  const rpc = new FetchRequest('https://sepolia-rollup.arbitrum.io/rpc');
  rpc.timeout = 9000;
  const provider = new JsonRpcProvider(rpc, chain, { staticNetwork: true });
  try {
    const contract = new Contract(address, abi, provider);
    const blockTag = await provider.getBlockNumber();
    const [deal, milestones] = await Promise.all([
      contract.getDeal(dealId, { blockTag }),
      contract.getMilestones(dealId, { blockTag }),
    ]);
    const item = milestones[milestone - 1];
    if (deal.client === ZeroAddress || !item) return hold('That deal or milestone does not exist on Arbitrum Sepolia.');
    if (deal.closed || deal.disputedAt !== 0n || Number(deal.currentMilestone) !== milestone - 1 ||
        Number(item.status) !== 1 || item.amount === 0n || deal.remaining < item.amount) {
      return hold('This milestone is not currently funded, submitted and awaiting client review.');
    }
    if (item.evidenceCommitment.toLowerCase() !== id(releaseUrl + '\n' + commit).toLowerCase()) {
      return hold('The release URL and current commit do not match the freelancer’s delivery commitment.');
    }
    return { status: 'verified', detail: 'The submitted, funded milestone commits to this release URL and commit.', source, block: blockTag };
  } catch {
    return hold('The Arbitrum Sepolia evidence was unavailable. Try again before approving.');
  } finally {
    provider.destroy();
  }
}
