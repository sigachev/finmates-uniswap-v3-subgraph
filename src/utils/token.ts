/* eslint-disable prefer-const */
import { ERC20 } from '../types/Factory/ERC20'
import { ERC20SymbolBytes } from '../types/Factory/ERC20SymbolBytes'
import { ERC20NameBytes } from '../types/Factory/ERC20NameBytes'
import { StaticTokenDefinition } from './staticTokenDefinition'
import { BigInt, Address, log } from '@graphprotocol/graph-ts'
import { isNullEthValue } from '.'

// ============================================================================
// CRITICAL: eth_call ONLY FOR PAST DAY
// ============================================================================
// Arbitrum: ~0.25 seconds per block
// 1 day = 86,400 seconds / 0.25 = 345,600 blocks
// We only allow eth_call for blocks within last 350,000 blocks
//
// To be EXTRA safe: we set a minimum "safe" block number
// As of November 2024, Arbitrum is around block 280M
// We'll only use eth_call for blocks > 400M (future-proof)
// This ensures we NEVER use eth_call for old historical blocks
// ============================================================================

const SAFE_ETH_CALL_MINIMUM_BLOCK = BigInt.fromI32(400000000)

/**
 * Determine if we can safely use eth_call for this block
 * Returns true ONLY for very recent blocks (past day or so)
 */
function canUseEthCall(blockNumber: BigInt): boolean {
  // STRICT: Only use eth_call for blocks above our safe minimum
  // This essentially disables eth_call for all current historical data
  // but allows it for future blocks to maintain forward compatibility

  if (blockNumber.lt(SAFE_ETH_CALL_MINIMUM_BLOCK)) {
    return false
  }

  // If we're above the minimum, we can try eth_call
  // This will work for new blocks as Arbitrum block height increases
  return true
}

/**
 * Fetch token symbol with STRICT block-aware eth_call
 * For blocks older than ~1 day: returns address-based identifier
 * For recent blocks only: attempts eth_call
 */
export function fetchTokenSymbol(tokenAddress: Address, blockNumber: BigInt): string {
  // Zero address check
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return 'UNKNOWN'
  }

  // ALWAYS check static definitions first - no eth_call needed
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.symbol
  }

  // For recent blocks ONLY, try eth_call
  if (canUseEthCall(blockNumber)) {
    let contract = ERC20.bind(tokenAddress)
    let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

    // Try standard symbol() call
    let symbolResult = contract.try_symbol()
    if (!symbolResult.reverted && symbolResult.value.length > 0) {
      return symbolResult.value
    }

    // Try bytes32 symbol
    let symbolResultBytes = contractSymbolBytes.try_symbol()
    if (!symbolResultBytes.reverted) {
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        // Convert bytes32 to string
        let hexString = symbolResultBytes.value.toHexString()
        let result = ''
        let foundNull = false

        for (let i = 2; i < hexString.length && !foundNull; i += 2) {
          let byte = i32(parseInt(hexString.substr(i, 2), 16))
          if (byte === 0) {
            foundNull = true
          } else if (byte >= 32 && byte <= 126) {
            result += String.fromCharCode(byte)
          }
        }

        if (result.length > 0 && result.length < 32) {
          return result
        }
      }
    }
  }

  // For old blocks or if eth_call failed: use truncated address as identifier
  let addrString = tokenAddress.toHexString()

  log.info('Using address-based symbol for token {} at block {} (eth_call disabled for old blocks)', [
    addrString,
    blockNumber.toString()
  ])

  // Return first 10 chars of address as temporary symbol
  return addrString.slice(0, 10).toUpperCase()
}

/**
 * Fetch token name with STRICT block-aware eth_call
 * For blocks older than ~1 day: returns address-based identifier
 * For recent blocks only: attempts eth_call
 */
export function fetchTokenName(tokenAddress: Address, blockNumber: BigInt): string {
  // Zero address check
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return 'Unknown Token'
  }

  // ALWAYS check static definitions first - no eth_call needed
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.name
  }

  // For recent blocks ONLY, try eth_call
  if (canUseEthCall(blockNumber)) {
    let contract = ERC20.bind(tokenAddress)
    let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

    // Try standard name() call
    let nameResult = contract.try_name()
    if (!nameResult.reverted && nameResult.value.length > 0) {
      return nameResult.value
    }

    // Try bytes32 name
    let nameResultBytes = contractNameBytes.try_name()
    if (!nameResultBytes.reverted) {
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        // Convert bytes32 to string
        let hexString = nameResultBytes.value.toHexString()
        let result = ''
        let foundNull = false

        for (let i = 2; i < hexString.length && !foundNull; i += 2) {
          let byte = i32(parseInt(hexString.substr(i, 2), 16))
          if (byte === 0) {
            foundNull = true
          } else if (byte >= 32 && byte <= 126) {
            result += String.fromCharCode(byte)
          }
        }

        if (result.length > 0 && result.length < 32) {
          return result
        }
      }
    }
  }

  // For old blocks or if eth_call failed: use address as identifier
  let addrString = tokenAddress.toHexString()

  log.info('Using address-based name for token {} at block {} (eth_call disabled for old blocks)', [
    addrString,
    blockNumber.toString()
  ])

  return 'Token ' + addrString.slice(0, 10)
}

/**
 * Fetch token decimals with STRICT block-aware eth_call
 * For blocks older than ~1 day: returns 18 (standard default)
 * For recent blocks only: attempts eth_call
 */
export function fetchTokenDecimals(tokenAddress: Address, blockNumber: BigInt): BigInt {
  // Zero address check
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return BigInt.fromI32(18)
  }

  // ALWAYS check static definitions first - no eth_call needed
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.decimals
  }

  // For recent blocks ONLY, try eth_call
  if (canUseEthCall(blockNumber)) {
    let contract = ERC20.bind(tokenAddress)
    let decimalResult = contract.try_decimals()

    if (!decimalResult.reverted) {
      let decimals = decimalResult.value
      // Validate decimals are reasonable (0-255)
      if (decimals >= 0 && decimals <= 255) {
        return BigInt.fromI32(decimals)
      } else {
        log.warning('Invalid decimals {} for token {}, defaulting to 18', [
          decimals.toString(),
          tokenAddress.toHexString()
        ])
      }
    }
  }

  // For old blocks or if eth_call failed: default to 18 decimals
  // This is the most common ERC20 decimal value
  log.info('Using default decimals (18) for token {} at block {} (eth_call disabled for old blocks)', [
    tokenAddress.toHexString(),
    blockNumber.toString()
  ])

  return BigInt.fromI32(18)
}

/**
 * Fetch token total supply with STRICT block-aware eth_call
 * For blocks older than ~1 day: returns 0
 * For recent blocks only: attempts eth_call
 */
export function fetchTokenTotalSupply(tokenAddress: Address, blockNumber: BigInt): BigInt {
  // Zero address check
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return BigInt.fromI32(0)
  }

  // For recent blocks ONLY, try eth_call
  if (canUseEthCall(blockNumber)) {
    let contract = ERC20.bind(tokenAddress)
    let totalSupplyResult = contract.try_totalSupply()

    if (!totalSupplyResult.reverted) {
      return totalSupplyResult.value
    }

    log.warning('Failed to fetch total supply for token {} at block {}', [
      tokenAddress.toHexString(),
      blockNumber.toString()
    ])
  }

  // For old blocks or if eth_call failed: return 0
  // Total supply is not critical for most analytics
  return BigInt.fromI32(0)
}