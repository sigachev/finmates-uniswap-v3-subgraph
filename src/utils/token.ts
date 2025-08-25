/* eslint-disable prefer-const */
import { ERC20 } from '../types/Factory/ERC20'
import { ERC20SymbolBytes } from '../types/Factory/ERC20SymbolBytes'
import { ERC20NameBytes } from '../types/Factory/ERC20NameBytes'
import { StaticTokenDefinition } from './staticTokenDefinition'
import { BigInt, Address, log } from '@graphprotocol/graph-ts'
import { isNullEthValue } from '.'

export function fetchTokenSymbol(tokenAddress: Address): string {
  // First check if it's a known problematic address
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return 'UNKNOWN'
  }

  // Check static definition first
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.symbol
  }

  let contract = ERC20.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  // try types string and bytes32 for symbol
  let symbolValue = 'unknown'

  // Try standard symbol() call first
  let symbolResult = contract.try_symbol()
  if (!symbolResult.reverted && symbolResult.value.length > 0) {
    symbolValue = symbolResult.value
  } else {
    // Try bytes32 symbol
    let symbolResultBytes = contractSymbolBytes.try_symbol()
    if (!symbolResultBytes.reverted) {
      // for broken pairs that have no symbol function exposed
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        // Convert bytes32 to string
        let hexString = symbolResultBytes.value.toHexString()
        let result = ''
        let foundNull = false

        for (let i = 2; i < hexString.length && !foundNull; i += 2) {
          let byte = i32(parseInt(hexString.substr(i, 2), 16))  // Explicit cast to i32
          if (byte === 0) {
            foundNull = true
          } else if (byte >= 32 && byte <= 126) { // printable ASCII
            result += String.fromCharCode(byte)
          }
        }

        if (result.length > 0 && result.length < 32) {
          symbolValue = result
        }
      }
    }
  }

  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  // First check if it's a known problematic address
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return 'Unknown Token'
  }

  // Check static definition first
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.name
  }

  let contract = ERC20.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  // try types string and bytes32 for name
  let nameValue = 'unknown'

  // Try standard name() call first
  let nameResult = contract.try_name()
  if (!nameResult.reverted && nameResult.value.length > 0) {
    nameValue = nameResult.value
  } else {
    // Try bytes32 name
    let nameResultBytes = contractNameBytes.try_name()
    if (!nameResultBytes.reverted) {
      // for broken exchanges that have no name function exposed
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        // Convert bytes32 to string
        let hexString = nameResultBytes.value.toHexString()
        let result = ''
        let foundNull = false

        for (let i = 2; i < hexString.length && !foundNull; i += 2) {
          let byte = i32(parseInt(hexString.substr(i, 2), 16))  // Explicit cast to i32
          if (byte === 0) {
            foundNull = true
          } else if (byte >= 32 && byte <= 126) { // printable ASCII
            result += String.fromCharCode(byte)
          }
        }

        if (result.length > 0 && result.length < 32) {
          nameValue = result
        }
      }
    }
  }

  return nameValue
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  // Check if it's a known problematic address
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return BigInt.fromI32(0)
  }

  let contract = ERC20.bind(tokenAddress)
  let totalSupplyResult = contract.try_totalSupply()

  if (!totalSupplyResult.reverted) {
    return totalSupplyResult.value
  }

  log.warning('Failed to fetch total supply for token {}', [tokenAddress.toHexString()])
  return BigInt.fromI32(0)
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
  // Check if it's a known problematic address
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return BigInt.fromI32(18)
  }

  // Check static definition first
  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.decimals
  }

  let contract = ERC20.bind(tokenAddress)
  let decimalResult = contract.try_decimals()

  if (!decimalResult.reverted) {
    let decimals = decimalResult.value
    // Validate decimals are reasonable (0-255)
    if (decimals >= 0 && decimals <= 255) {
      return BigInt.fromI32(decimals)
    } else {
      log.warning('Invalid decimals {} for token {}, defaulting to 18', [decimals.toString(), tokenAddress.toHexString()])
    }
  }

  // Default to 18 decimals if we can't fetch them
  log.warning('Failed to fetch decimals for token {}, defaulting to 18', [tokenAddress.toHexString()])
  return BigInt.fromI32(18)
}