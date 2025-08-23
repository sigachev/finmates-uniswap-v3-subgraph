#!/bin/bash

# Comprehensive Subgraph Sync Monitoring Script

# Configuration
GRAPHQL_ENDPOINT="https://arbitrum-graph.finmates.com/subgraphs/name/finmates/uniswap-v3"
INDEX_NODE_ENDPOINT="https://arbitrum-graph.finmates.com/index-node/graphql"
SUBGRAPH_NAME="finmates/uniswap-v3"
REFRESH_INTERVAL=5

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Functions
get_sync_status() {
    curl -sk -X POST "$INDEX_NODE_ENDPOINT" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"{indexingStatusForCurrentVersion(subgraphName: \\\"$SUBGRAPH_NAME\\\") { synced health chains { network chainHeadBlock { number } latestBlock { number } } fatalError { message block { number } } nonFatalErrors { message } }}\"}" 2>/dev/null
}

get_subgraph_stats() {
    curl -sk -X POST "$GRAPHQL_ENDPOINT" \
        -H "Content-Type: application/json" \
        -d '{"query": "{ factories(first: 1) { poolCount txCount totalVolumeUSD totalValueLockedUSD } pools(first: 1) { id } _meta { block { number hash timestamp } hasIndexingErrors } }"}' 2>/dev/null
}

format_number() {
    echo $1 | sed ':a;s/\B[0-9]\{3\}\>/,&/;ta'
}

calculate_progress() {
    if [ -z "$1" ] || [ -z "$2" ] || [ "$1" == "null" ] || [ "$2" == "null" ]; then
        echo "0"
        return
    fi
    echo "scale=2; ($1 / $2) * 100" | bc 2>/dev/null || echo "0"
}

monitor_sync() {
    while true; do
        clear
        echo -e "${BLUE}=== Finmates Uniswap V3 Subgraph Sync Monitor ===${NC}"
        echo -e "${CYAN}Time: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
        echo -e "${CYAN}Endpoint: $GRAPHQL_ENDPOINT${NC}"
        echo ""

        # Get sync status
        SYNC_STATUS=$(get_sync_status)

        if [ -z "$SYNC_STATUS" ]; then
            echo -e "${RED}Error: Could not connect to index node${NC}"
        else
            # Parse sync status
            SYNCED=$(echo $SYNC_STATUS | jq -r '.data.indexingStatusForCurrentVersion[0].synced' 2>/dev/null)
            HEALTH=$(echo $SYNC_STATUS | jq -r '.data.indexingStatusForCurrentVersion[0].health' 2>/dev/null)
            CHAIN_HEAD=$(echo $SYNC_STATUS | jq -r '.data.indexingStatusForCurrentVersion[0].chains[0].chainHeadBlock.number' 2>/dev/null)
            LATEST_INDEXED=$(echo $SYNC_STATUS | jq -r '.data.indexingStatusForCurrentVersion[0].chains[0].latestBlock.number' 2>/dev/null)
            FATAL_ERROR=$(echo $SYNC_STATUS | jq -r '.data.indexingStatusForCurrentVersion[0].fatalError.message' 2>/dev/null)

            # Display sync status
            echo -e "${YELLOW}=== Indexing Status ===${NC}"

            if [ "$SYNCED" == "true" ]; then
                echo -e "Synced: ${GREEN}✓ Yes${NC}"
            else
                echo -e "Synced: ${YELLOW}⟳ In Progress${NC}"
            fi

            if [ "$HEALTH" == "healthy" ]; then
                echo -e "Health: ${GREEN}✓ Healthy${NC}"
            elif [ "$HEALTH" == "unhealthy" ]; then
                echo -e "Health: ${RED}✗ Unhealthy${NC}"
            else
                echo -e "Health: ${YELLOW}? $HEALTH${NC}"
            fi

            if [ "$CHAIN_HEAD" != "null" ] && [ "$LATEST_INDEXED" != "null" ]; then
                BLOCKS_BEHIND=$((CHAIN_HEAD - LATEST_INDEXED))
                PROGRESS=$(calculate_progress $LATEST_INDEXED $CHAIN_HEAD)

                echo ""
                echo -e "${YELLOW}=== Block Progress ===${NC}"
                echo -e "Chain Head:      $(format_number $CHAIN_HEAD)"
                echo -e "Latest Indexed:  $(format_number $LATEST_INDEXED)"
                echo -e "Blocks Behind:   ${YELLOW}$(format_number $BLOCKS_BEHIND)${NC}"
                echo -e "Progress:        ${GREEN}${PROGRESS}%${NC}"

                # Estimate sync time (rough estimate: ~100 blocks/second)
                if [ $BLOCKS_BEHIND -gt 0 ]; then
                    ETA_SECONDS=$((BLOCKS_BEHIND / 100))
                    ETA_MINUTES=$((ETA_SECONDS / 60))
                    ETA_HOURS=$((ETA_MINUTES / 60))

                    if [ $ETA_HOURS -gt 0 ]; then
                        echo -e "Estimated Time:  ${CYAN}~${ETA_HOURS} hours${NC}"
                    elif [ $ETA_MINUTES -gt 0 ]; then
                        echo -e "Estimated Time:  ${CYAN}~${ETA_MINUTES} minutes${NC}"
                    else
                        echo -e "Estimated Time:  ${CYAN}~${ETA_SECONDS} seconds${NC}"
                    fi
                fi
            fi

            # Check for errors
            if [ "$FATAL_ERROR" != "null" ] && [ -n "$FATAL_ERROR" ]; then
                echo ""
                echo -e "${RED}=== Fatal Error ===${NC}"
                echo -e "${RED}$FATAL_ERROR${NC}"
            fi
        fi

        # Get subgraph stats
        echo ""
        echo -e "${YELLOW}=== Subgraph Statistics ===${NC}"

        STATS=$(get_subgraph_stats)
        if [ -n "$STATS" ]; then
            POOL_COUNT=$(echo $STATS | jq -r '.data.factories[0].poolCount' 2>/dev/null)
            TX_COUNT=$(echo $STATS | jq -r '.data.factories[0].txCount' 2>/dev/null)
            VOLUME_USD=$(echo $STATS | jq -r '.data.factories[0].totalVolumeUSD' 2>/dev/null)
            TVL_USD=$(echo $STATS | jq -r '.data.factories[0].totalValueLockedUSD' 2>/dev/null)
            CURRENT_BLOCK=$(echo $STATS | jq -r '.data._meta.block.number' 2>/dev/null)
            HAS_ERRORS=$(echo $STATS | jq -r '.data._meta.hasIndexingErrors' 2>/dev/null)

            if [ "$CURRENT_BLOCK" != "null" ]; then
                echo -e "Current Block:   $(format_number $CURRENT_BLOCK)"
            fi

            if [ "$POOL_COUNT" != "null" ]; then
                echo -e "Pools Created:   ${GREEN}$(format_number $POOL_COUNT)${NC}"
            else
                echo -e "Pools Created:   ${YELLOW}Indexing...${NC}"
            fi

            if [ "$TX_COUNT" != "null" ]; then
                echo -e "Transactions:    ${GREEN}$(format_number $TX_COUNT)${NC}"
            fi

            if [ "$VOLUME_USD" != "null" ] && [ "$VOLUME_USD" != "0" ]; then
                VOLUME_FORMATTED=$(echo $VOLUME_USD | awk '{printf "$%'\''d\n", $1}' 2>/dev/null || echo "$VOLUME_USD")
                echo -e "Total Volume:    ${GREEN}$VOLUME_FORMATTED${NC}"
            fi

            if [ "$TVL_USD" != "null" ] && [ "$TVL_USD" != "0" ]; then
                TVL_FORMATTED=$(echo $TVL_USD | awk '{printf "$%'\''d\n", $1}' 2>/dev/null || echo "$TVL_USD")
                echo -e "Total TVL:       ${GREEN}$TVL_FORMATTED${NC}"
            fi

            if [ "$HAS_ERRORS" == "true" ]; then
                echo -e "\n${RED}⚠ Indexing errors detected${NC}"
            fi
        else
            echo -e "${YELLOW}Waiting for data...${NC}"
        fi

        # Graph Node logs check (optional)
        echo ""
        echo -e "${YELLOW}=== Recent Activity ===${NC}"
        echo -e "Checking Graph Node logs..."

        # Get recent logs
        RECENT_LOGS=$(kubectl logs -n graph deployment/graph-node --tail=5 2>/dev/null | grep -i "finmates" | tail -3)
        if [ -n "$RECENT_LOGS" ]; then
            echo "$RECENT_LOGS" | while read line; do
                echo -e "${CYAN}> ${line:0:80}...${NC}"
            done
        else
            echo -e "${CYAN}> No recent activity in logs${NC}"
        fi

        echo ""
        echo -e "${CYAN}Refreshing in $REFRESH_INTERVAL seconds... (Press Ctrl+C to exit)${NC}"
        sleep $REFRESH_INTERVAL
    done
}

# Single check mode
single_check() {
    echo -e "${BLUE}=== Finmates Uniswap V3 Subgraph Status ===${NC}"
    echo -e "${CYAN}Time: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo ""

    # Quick status check
    STATS=$(get_subgraph_stats)
    SYNC_STATUS=$(get_sync_status)

    if [ -n "$STATS" ]; then
        CURRENT_BLOCK=$(echo $STATS | jq -r '.data._meta.block.number' 2>/dev/null)
        POOL_COUNT=$(echo $STATS | jq -r '.data.factories[0].poolCount' 2>/dev/null)

        echo -e "Current Block: ${GREEN}$(format_number $CURRENT_BLOCK)${NC}"
        echo -e "Pools Indexed: ${GREEN}$(format_number $POOL_COUNT)${NC}"

        if [ -n "$SYNC_STATUS" ]; then
            CHAIN_HEAD=$(echo $SYNC_STATUS | jq -r '.data.indexingStatusForCurrentVersion[0].chains[0].chainHeadBlock.number' 2>/dev/null)
            if [ "$CHAIN_HEAD" != "null" ] && [ "$CURRENT_BLOCK" != "null" ]; then
                BLOCKS_BEHIND=$((CHAIN_HEAD - CURRENT_BLOCK))
                echo -e "Blocks Behind: ${YELLOW}$(format_number $BLOCKS_BEHIND)${NC}"
            fi
        fi
    else
        echo -e "${RED}Could not fetch subgraph data${NC}"
    fi
}

# Main script
case "${1:-}" in
    "-c"|"--continuous")
        monitor_sync
        ;;
    "-h"|"--help")
        echo "Usage: $0 [options]"
        echo "Options:"
        echo "  -c, --continuous    Monitor continuously (default: single check)"
        echo "  -h, --help         Show this help message"
        ;;
    *)
        single_check
        ;;
esac