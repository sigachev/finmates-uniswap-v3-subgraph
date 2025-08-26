/* eslint-disable prefer-const */
import { ERC20 } from '../types/Factory/ERC20'
import { ERC20SymbolBytes } from '../types/Factory/ERC20SymbolBytes'
import { ERC20NameBytes } from '../types/Factory/ERC20NameBytes'
import { StaticTokenDefinition } from './staticTokenDefinition'
import { BigInt, Address, log } from '@graphprotocol/graph-ts'
import { isNullEthValue } from '.'

// Add a list of known problematic tokens that might cause issues
const PROBLEMATIC_TOKENS: string[] = [
  // Add any known problematic token addresses here
]

export function fetchTokenSymbol(tokenAddress: Address): string {
  let addressHex = tokenAddress.toHexString()

  // Skip known problematic addresses
  if (addressHex == '0x0000000000000000000000000000000000000000' ||
    PROBLEMATIC_TOKENS.includes(addressHex)) {
    log.warning('Skipping problematic token address: {}', [addressHex])
    return 'UNKNOWN'
  }

  // Check static definition first
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    log.info('Using static definition for token symbol: {}', [staticTokenDefinition.symbol])
    return staticTokenDefinition.symbol
  }

  let symbolValue = 'unknown'

  // Try standard symbol() call with better error handling
  try {
    let contract = ERC20.bind(tokenAddress)
    let symbolResult = contract.try_symbol()

    if (!symbolResult.reverted && symbolResult.value.length > 0) {
      symbolValue = symbolResult.value
      log.info('Successfully fetched symbol: {} for token: {}', [symbolValue, addressHex])
      return symbolValue
    }
  } catch (e) {
    log.warning('Failed to fetch symbol using standard method for {}: {}', [addressHex, e.toString()])
  }

  // Try bytes32 symbol
  try {
    let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)
    let symbolResultBytes = contractSymbolBytes.try_symbol()

    if (!symbolResultBytes.reverted) {
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        let hexString = symbolResultBytes.value.toHexString()
        let result = ''
        let foundNull = false

        for (let i = 2; i < hexString.length && !foundNull; i += 2) {
          let byte = parseInt(hexString.substr(i, 2), 16) as i32
          if (byte === 0) {
            foundNull = true
          } else if (byte >= 32 && byte <= 126) {
            result += String.fromCharCode(byte)
          }
        }

        if (result.length > 0 && result.length < 32) {
          symbolValue = result
          log.info('Successfully fetched bytes32 symbol: {} for token: {}', [symbolValue, addressHex])
          return symbolValue
        }
      }
    }
  } catch (e) {
    log.warning('Failed to fetch symbol using bytes32 method for {}: {}', [addressHex, e.toString()])
  }

  log.warning('Could not fetch symbol for token: {}, using default', [addressHex])
  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  let addressHex = tokenAddress.toHexString()

  // Skip known problematic addresses
  if (addressHex == '0x0000000000000000000000000000000000000000' ||
    PROBLEMATIC_TOKENS.includes(addressHex)) {
    log.warning('Skipping problematic token address: {}', [addressHex])
    return 'Unknown Token'
  }

  // Check static definition first
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    log.info('Using static definition for token name: {}', [staticTokenDefinition.name])
    return staticTokenDefinition.name
  }

  let nameValue = 'unknown'

  // Try standard name() call
  try {
    let contract = ERC20.bind(tokenAddress)
    let nameResult = contract.try_name()

    if (!nameResult.reverted && nameResult.value.length > 0) {
      nameValue = nameResult.value
      log.info('Successfully fetched name: {} for token: {}', [nameValue, addressHex])
      return nameValue
    }
  } catch (e) {
    log.warning('Failed to fetch name using standard method for {}: {}', [addressHex, e.toString()])
  }

  // Try bytes32 name
  try {
    let contractNameBytes = ERC20NameBytes.bind(tokenAddress)
    let nameResultBytes = contractNameBytes.try_name()

    if (!nameResultBytes.reverted) {
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        let hexString = nameResultBytes.value.toHexString()
        let result = ''
        let foundNull = false

        for (let i = 2; i < hexString.length && !foundNull; i += 2) {
          let byte = parseInt(hexString.substr(i, 2), 16) as i32
          if (byte === 0) {
            foundNull = true
          } else if (byte >= 32 && byte <= 126) {
            result += String.fromCharCode(byte)
          }
        }

        if (result.length > 0 && result.length < 32) {
          nameValue = result
          log.info('Successfully fetched bytes32 name: {} for token: {}', [nameValue, addressHex])
          return nameValue
        }
      }
    }
  } catch (e) {
    log.warning('Failed to fetch name using bytes32 method for {}: {}', [addressHex, e.toString()])
  }

  log.warning('Could not fetch name for token: {}, using default', [addressHex])
  return nameValue
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  let addressHex = tokenAddress.toHexString()

  // Skip known problematic addresses
  if (addressHex == '0x0000000000000000000000000000000000000000' ||
    PROBLEMATIC_TOKENS.includes(addressHex)) {
    log.warning('Skipping problematic token address: {}', [addressHex])
    return BigInt.fromI32(0)
  }

  try {
    let contract = ERC20.bind(tokenAddress)
    let totalSupplyResult = contract.try_totalSupply()

    if (!totalSupplyResult.reverted) {
      log.info('Successfully fetched total supply for token: {}', [addressHex])
      return totalSupplyResult.value
    }
  } catch (e) {
    log.warning('Failed to fetch total supply for {}: {}', [addressHex, e.toString()])
  }

  log.warning('Failed to fetch total supply for token: {}, returning 0', [addressHex])
  return BigInt.fromI32(0)
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
  let addressHex = tokenAddress.toHexString()

  // Skip known problematic addresses
  if (addressHex == '0x0000000000000000000000000000000000000000' ||
    PROBLEMATIC_TOKENS.includes(addressHex)) {
    log.warning('Skipping problematic token address: {}', [addressHex])
    return BigInt.fromI32(18)
  }

  // Check static definition first
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    log.info('Using static definition for token decimals: {}', [staticTokenDefinition.decimals.toString()])
    return staticTokenDefinition.decimals
  }

  try {
    let contract = ERC20.bind(tokenAddress)
    let decimalResult = contract.try_decimals()

    if (!decimalResult.reverted) {
      let decimals = decimalResult.value
      // Validate decimals are reasonable (0-255)
      if (decimals >= 0 && decimals <= 255) {
        log.info('Successfully fetched decimals: {} for token: {}', [decimals.toString(), addressHex])
        return BigInt.fromI32(decimals)
      } else {
        log.warning('Invalid decimals {} for token {}, defaulting to 18', [
          decimals.toString(),
          addressHex
        ])
      }
    }
  } catch (e) {
    log.warning('Failed to fetch decimals for {}: {}', [addressHex, e.toString()])
  }

  // Default to 18 decimals if we can't fetch them
  log.warning('Failed to fetch decimals for token: {}, defaulting to 18', [addressHex])
  return BigInt.fromI32(18)
}