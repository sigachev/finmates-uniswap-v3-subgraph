import { Position, PositionSnapshot, Transaction } from '../types/schema'
import { BigInt, ethereum, log } from '@graphprotocol/graph-ts'

/**
 * Create a snapshot of a position's current state
 * This tracks the position over time for historical analysis
 */
export function createPositionSnapshot(
  position: Position,
  event: ethereum.Event
): PositionSnapshot {
  // Create unique ID: position-timestamp
  let snapshotId = position.id + '-' + event.block.timestamp.toString()
  let snapshot = new PositionSnapshot(snapshotId)

  // Basic info
  snapshot.owner = position.owner
  snapshot.pool = position.pool
  snapshot.position = position.id
  snapshot.blockNumber = event.block.number
  snapshot.timestamp = event.block.timestamp

  // Position state
  snapshot.liquidity = position.liquidity

  // Deposited amounts
  snapshot.depositedToken0 = position.depositedToken0
  snapshot.depositedToken1 = position.depositedToken1

  // Withdrawn amounts
  snapshot.withdrawnToken0 = position.withdrawnToken0
  snapshot.withdrawnToken1 = position.withdrawnToken1

  // Collected fees
  snapshot.collectedFeesToken0 = position.collectedFeesToken0
  snapshot.collectedFeesToken1 = position.collectedFeesToken1

  // Transaction reference
  snapshot.transaction = event.transaction.hash.toHexString()

  // Fee growth tracking
  snapshot.feeGrowthInside0LastX128 = position.feeGrowthInside0LastX128
  snapshot.feeGrowthInside1LastX128 = position.feeGrowthInside1LastX128

  snapshot.save()

  log.info('Created position snapshot {} for position {} at block {}', [
    snapshotId,
    position.id,
    event.block.number.toString()
  ])

  return snapshot as PositionSnapshot
}

/**
 * Helper to decide if a snapshot should be created
 * Avoids creating too many snapshots (e.g., skip tiny changes)
 */
export function shouldCreateSnapshot(
  position: Position,
  event: ethereum.Event,
  eventType: string
): boolean {
  // Always create snapshot for these events
  if (eventType == 'MINT' || eventType == 'BURN' || eventType == 'TRANSFER') {
    return true
  }

  // For other events, could add logic to reduce snapshot frequency
  // For example: only create snapshot if liquidity changed by >1%
  // Or: only create snapshot once per hour per position

  // For now, create snapshot for all events
  return true
}