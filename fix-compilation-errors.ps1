# fix-compilation-errors.ps1
Write-Host "🔧 Fixing AssemblyScript compilation errors..." -ForegroundColor Green

# Fix 1: Add explicit type casts in token.ts
Write-Host "Fixing src/utils/token.ts..." -ForegroundColor Yellow
$tokenContent = Get-Content -Path "src\utils\token.ts" -Raw
$tokenContent = $tokenContent -replace 'let byte = parseInt\(hexString\.substr\(i, 2\), 16\)', 'let byte = i32(parseInt(hexString.substr(i, 2), 16))'
Set-Content -Path "src\utils\token.ts" -Value $tokenContent

# Fix 2: Remove try-catch from pricing.ts
Write-Host "Fixing src/utils/pricing.ts..." -ForegroundColor Yellow
$pricingContent = Get-Content -Path "src\utils\pricing.ts" -Raw

# Replace the try-catch block
$oldBlock = @'
      try {
        let prices = sqrtPriceX96ToTokenPrices(usdcPool.sqrtPrice, token0, token1)
        // USDC is token1, so we want token1Price which is ETH/USDC
        if (prices[1].gt(ZERO_BD) && prices[1].lt(BigDecimal.fromString('100000'))) { // Sanity check
          return prices[1]
        }
      } catch (e) {
        log.warning('Failed to calculate ETH price from pool: {}', [e.toString()])
      }
'@

$newBlock = @'
      let prices = sqrtPriceX96ToTokenPrices(usdcPool.sqrtPrice, token0, token1)
      // USDC is token1, so we want token1Price which is ETH/USDC
      if (prices[1].gt(ZERO_BD) && prices[1].lt(BigDecimal.fromString('100000'))) { // Sanity check
        return prices[1]
      }
'@

$pricingContent = $pricingContent.Replace($oldBlock, $newBlock)
Set-Content -Path "src\utils\pricing.ts" -Value $pricingContent

# Fix 3: Remove try-catch blocks from core.ts
Write-Host "Fixing src/mappings/core.ts..." -ForegroundColor Yellow
$coreContent = Get-Content -Path "src\mappings\core.ts" -Raw

# First try-catch block
$oldBlock1 = @'
    try {
      let prices = sqrtPriceX96ToTokenPrices(pool.sqrtPrice, token0 as Token, token1 as Token)
      pool.token0Price = prices[0]
      pool.token1Price = prices[1]
    } catch (e) {
      log.warning('Failed to calculate initial prices for pool {}: {}', [pool.id, e.toString()])
      pool.token0Price = ZERO_BD
      pool.token1Price = ZERO_BD
    }
'@

$newBlock1 = @'
    let prices = sqrtPriceX96ToTokenPrices(pool.sqrtPrice, token0 as Token, token1 as Token)
    pool.token0Price = prices[0]
    pool.token1Price = prices[1]
'@

$coreContent = $coreContent.Replace($oldBlock1, $newBlock1)

# Second try-catch block
$oldBlock2 = @'
  // Safe update of pool data
  try {
    updatePoolDayData(event)
    updatePoolHourData(event)
  } catch (e) {
    log.error('Failed to update pool data in handleInitialize: {}', [e.toString()])
  }
'@

$newBlock2 = @'
  // Update pool data
  updatePoolDayData(event)
  updatePoolHourData(event)
'@

$coreContent = $coreContent.Replace($oldBlock2, $newBlock2)
Set-Content -Path "src\mappings\core.ts" -Value $coreContent

Write-Host "✅ All fixes applied!" -ForegroundColor Green
Write-Host "Now run: npm run build" -ForegroundColor Cyan