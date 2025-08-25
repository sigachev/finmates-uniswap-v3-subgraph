/* eslint-disable prefer-const */
import { ONE_BD, ZERO_BD, ZERO_BI } from './constants'
import { Bundle, Pool, Token } from '../types/schema'
import { BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { exponentToBigDecimal, safeDiv } from '../utils/index'

const WETH_ADDRESS = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
const USDC_WETH_03_POOL = '0x17c14d2c404d167802b16c450d3c99f88f2c4f4d'

// token where amounts should contribute to tracked volume and liquidity
// usually tokens that many tokens are paired with
export let WHITELIST_TOKENS: string[] = [
  WETH_ADDRESS, // WETH
  '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', // USDC
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
  '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', // WBTC
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
  '0xf97f4df75117a78c1a5a0dbb814af92458539fb4' // LINK
]

let MINIMUM_ETH_LOCKED = BigDecimal.fromString('0.01')

// Q192 = 2^192 as a string to avoid JavaScript number overflow
const Q192 = '6277101735386680763835789423207666416102355444464034512896'

// Helper function to ensure bundle exists
function ensureBundleExists(): Bundle {
  let bundle = Bundle.load('1')
  if (bundle === null) {
    bundle = new Bundle('1')
    bundle.ethPriceUSD = BigDecimal.fromString('2000') // Default ETH price
    bundle.save()
  }

  // Always ensure we have a valid ETH price
  if (bundle.ethPriceUSD.equals(ZERO_BD) || bundle.ethPriceUSD.toString() == '0') {
    bundle.ethPriceUSD = BigDecimal.fromString('2000')
    bundle.save()
  }

  return bundle as Bundle
}

export function sqrtPriceX96ToTokenPrices(sqrtPriceX96: BigInt, token0: Token, token1: Token): BigDecimal[] {
  // Validate inputs
  if (sqrtPriceX96.equals(ZERO_BI)) {
    log.warning('sqrtPriceX96 is zero, returning zero prices', [])
    return [ZERO_BD, ZERO_BD]
  }

  let num = sqrtPriceX96.times(sqrtPriceX96).toBigDecimal()
  let denom = BigDecimal.fromString(Q192)

  // Ensure we have valid decimals with fallback to 18
  let token0Decimals = token0.decimals.equals(ZERO_BI) ? BigInt.fromI32(18) : token0.decimals
  let token1Decimals = token1.decimals.equals(ZERO_BI) ? BigInt.fromI32(18) : token1.decimals

  // Validate decimals are reasonable
  if (token0Decimals.gt(BigInt.fromI32(255)) || token1Decimals.gt(BigInt.fromI32(255))) {
    log.warning('Token decimals exceed maximum, using 18', [])
    token0Decimals = BigInt.fromI32(18)
    token1Decimals = BigInt.fromI32(18)
  }

  let price1 = num
    .div(denom)
    .times(exponentToBigDecimal(token0Decimals))
    .div(exponentToBigDecimal(token1Decimals))

  // Safe division with check
  let price0 = price1.equals(ZERO_BD) ? ZERO_BD : safeDiv(ONE_BD, price1)

  return [price0, price1]
}

export function getEthPriceInUSD(): BigDecimal {
  // Ensure bundle exists first
  let bundle = ensureBundleExists()

  // fetch eth prices for each stablecoin
  let usdcPool = Pool.load(USDC_WETH_03_POOL) // usdc is token1

  if (usdcPool !== null && usdcPool.liquidity.gt(ZERO_BI) && usdcPool.sqrtPrice.gt(ZERO_BI)) {
    let token0 = Token.load(usdcPool.token0)
    let token1 = Token.load(usdcPool.token1)

    if (token0 !== null && token1 !== null) {
      try {
        let prices = sqrtPriceX96ToTokenPrices(usdcPool.sqrtPrice, token0, token1)
        // USDC is token1, so we want token1Price which is ETH/USDC
        if (prices[1].gt(ZERO_BD) && prices[1].lt(BigDecimal.fromString('100000'))) { // Sanity check
          return prices[1]
        }
      } catch (e) {
        log.warning('Failed to calculate ETH price from pool: {}', [e.toString()])
      }
    }
  }

  // Return the existing bundle price or default
  if (!bundle.ethPriceUSD.equals(ZERO_BD)) {
    return bundle.ethPriceUSD
  }

  // Return a default ETH price if we can't calculate it yet
  // This is a reasonable estimate for Arbitrum ETH price
  return BigDecimal.fromString('2000')
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }

  let whiteList = token.whitelistPools
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestLiquidityETH = ZERO_BD
  let priceSoFar = ZERO_BD

  // Bundle for ETH price
  let bundle = ensureBundleExists()

  for (let i = 0; i < whiteList.length; ++i) {
    let poolAddress = whiteList[i]
    let pool = Pool.load(poolAddress)

    if (pool === null) {
      log.warning('Pool not found in findEthPerToken: {}', [poolAddress])
      continue
    }

    if (pool.liquidity.gt(ZERO_BI) && pool.sqrtPrice.gt(ZERO_BI)) {
      if (pool.token0 == token.id) {
        // whitelist token is token1
        let token1 = Token.load(pool.token1)
        if (token1 === null) {
          continue
        }
        // get the derived ETH in pool
        let ethLocked = pool.totalValueLockedToken1.times(token1.derivedETH)
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(MINIMUM_ETH_LOCKED)) {
          largestLiquidityETH = ethLocked
          // token1 per our token * Eth per token1
          priceSoFar = pool.token1Price.times(token1.derivedETH as BigDecimal)
        }
      }
      if (pool.token1 == token.id) {
        let token0 = Token.load(pool.token0)
        if (token0 === null) {
          continue
        }
        // get the derived ETH in pool
        let ethLocked = pool.totalValueLockedToken0.times(token0.derivedETH)
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(MINIMUM_ETH_LOCKED)) {
          largestLiquidityETH = ethLocked
          // token0 per our token * ETH per token0
          priceSoFar = pool.token0Price.times(token0.derivedETH as BigDecimal)
        }
      }
    }
  }

  // Sanity check on price
  if (priceSoFar.gt(BigDecimal.fromString('1000000'))) {
    log.warning('Derived ETH price for token {} seems too high: {}, returning 0', [token.id, priceSoFar.toString()])
    return ZERO_BD
  }

  return priceSoFar // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedAmountUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = ensureBundleExists()

  let price0USD = token0.derivedETH.times(bundle.ethPriceUSD)
  let price1USD = token1.derivedETH.times(bundle.ethPriceUSD)

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.includes(token0.id) && !WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount1.times(price1USD).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked amount is 0
  return ZERO_BD
}