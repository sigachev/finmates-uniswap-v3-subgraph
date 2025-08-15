// src/mappings/pool.ts
import { BigInt, Address } from '@graphprotocol/graph-ts'
import {
    Initialize,
    Swap,
    Mint as MintEvent,
    Burn as BurnEvent,
    Flash
} from '../../generated/templates/Pool/Pool'
import { Pool, Token, Swap as SwapEntity, Mint, Burn } from '../../generated/schema'

export function handleInitialize(event: Initialize): void {
    let pool = Pool.load(event.address.toHexString())
    if (pool !== null) {
        pool.sqrtPrice = event.params.sqrtPriceX96
        pool.tick = BigInt.fromI32(event.params.tick)
        pool.save()
    }
}

export function handleSwap(event: Swap): void {
    let pool = Pool.load(event.address.toHexString())
    if (pool === null) {
        return
    }

    // Create swap entity
    let swap = new SwapEntity(
        event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
    )

    swap.pool = pool.id
    swap.sender = event.params.sender
    swap.recipient = event.params.recipient
    swap.amount0 = event.params.amount0
    swap.amount1 = event.params.amount1
    swap.sqrtPriceX96 = event.params.sqrtPriceX96
    swap.liquidity = event.params.liquidity
    swap.tick = BigInt.fromI32(event.params.tick)
    swap.timestamp = event.block.timestamp
    swap.transaction = event.transaction.hash

    swap.save()

    // Update pool state
    pool.sqrtPrice = event.params.sqrtPriceX96
    pool.tick = BigInt.fromI32(event.params.tick)
    pool.liquidity = event.params.liquidity
    pool.save()
}

export function handleMint(event: MintEvent): void {
    let pool = Pool.load(event.address.toHexString())
    if (pool === null) {
        return
    }

    let mint = new Mint(
        event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
    )

    mint.pool = pool.id
    mint.owner = event.params.owner
    mint.sender = event.params.sender
    mint.tickLower = BigInt.fromI32(event.params.tickLower)
    mint.tickUpper = BigInt.fromI32(event.params.tickUpper)
    mint.amount = event.params.amount
    mint.amount0 = event.params.amount0
    mint.amount1 = event.params.amount1
    mint.timestamp = event.block.timestamp
    mint.transaction = event.transaction.hash

    mint.save()
}

export function handleBurn(event: BurnEvent): void {
    let pool = Pool.load(event.address.toHexString())
    if (pool === null) {
        return
    }

    let burn = new Burn(
        event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
    )

    burn.pool = pool.id
    burn.owner = event.params.owner
    burn.tickLower = BigInt.fromI32(event.params.tickLower)
    burn.tickUpper = BigInt.fromI32(event.params.tickUpper)
    burn.amount = event.params.amount
    burn.amount0 = event.params.amount0
    burn.amount1 = event.params.amount1
    burn.timestamp = event.block.timestamp
    burn.transaction = event.transaction.hash

    burn.save()
}

export function handleFlash(event: Flash): void {
    // Handle flash loan events if needed
}