const vscode = acquireVsCodeApi();
let currentResults = null;
let sortState = { column: null, direction: null };
let resolvedColumns = new Map(); // Store resolved identity data by column index
let resolvedCells = new Set(); // Store individually resolved cells as "row-col" strings
let animatingCells = new Set(); // Track cells that are currently animating to avoid disruption

// GUID detection utilities
const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isGuid(value) {
    if (typeof value !== 'string') {
        return false;
    }
    return GUID_REGEX.test(value);
}

function isGuidColumn(columnData, threshold = 0.7) {
    if (!columnData || columnData.length === 0) {
        return false;
    }

    // Filter out null/undefined values
    const nonNullValues = columnData.filter(value => value !== null && value !== undefined);
    
    if (nonNullValues.length === 0) {
        return false;
    }

    // Count how many values are GUIDs
    const guidCount = nonNullValues.filter(value => isGuid(value)).length;
    
    // Return true if threshold percentage of values are GUIDs
    return (guidCount / nonNullValues.length) >= threshold;
}

function isLikelyIdentityColumn(columnName) {
    const lowerColumnName = columnName.toLowerCase().replace(/[_\s-]/g, '');
    const identityNames = [
        'principalid', 'objectid', 'userid', 'groupid', 'applicationid',
        'serviceprincipalid', 'clientid', 'assignedto', 'assignedby',
        'createdby', 'modifiedby', 'ownerid', 'memberid'
    ];
    
    return identityNames.some(name => 
        lowerColumnName.includes(name) || lowerColumnName.endsWith('id')
    );
}

function shouldShowResolveButton(columnName, columnData) {
    return isLikelyIdentityColumn(columnName) && isGuidColumn(columnData);
}

// Helper function to check if a cell is safe to update (not currently animating)
function isCellSafeToUpdate(targetCell, row, col) {
    const cellKey = `${row}-${col}`;
    
    // If cell is marked as animating, it's not safe unless we're specifically fading it
    if (animatingCells.has(cellKey)) {
        return false;
    }
    
    // Check if cell has an active animation (not fading out)
    const loadingElement = targetCell ? targetCell.querySelector('.guid-loading:not(.fade-out)') : null;
    if (loadingElement) {
        // Mark this cell as animating to track it
        animatingCells.add(cellKey);
        return false;
    }
    
    return true;
}

// Helper function to mark a cell as no longer animating
function markCellNotAnimating(row, col) {
    const cellKey = `${row}-${col}`;
    animatingCells.delete(cellKey);
}

// Generate truly random animation values for each loading element
function getRandomAnimationValues() {
    // Use performance.now() to add extra entropy and ensure uniqueness
    const timestamp = performance.now() % 1; // Get fractional milliseconds
    const entropy = Math.random() * 0.01 + timestamp * 0.001; // Combine random + timestamp
    return {
        offset: -Math.random() * 3 + entropy, // Random point in cycle (-3s to 0s) + entropy
        duration: 1.5 + Math.random() * 3 + entropy // Duration between 1.5s and 4.5s + entropy
    };
}

function isColumnResolvedOrHasResolvedVersion(columnIndex) {
    // Check if this column index is directly in resolvedColumns (meaning it's a resolved column)
    if (resolvedColumns.has(columnIndex)) {
        return true;
    }
    
    // Check if there's a resolved column for this original column that was FULLY resolved
    // Look for a resolved column that has this column as its originalColumnIndex
    for (const [resolvedColumnIndex, columnInfo] of resolvedColumns.entries()) {
        if (columnInfo.originalColumnIndex === columnIndex && !columnInfo.isSingleCellResolution) {
            return true;
        }
    }
    
    return false;
}

function isCellIndividuallyResolved(row, col) {
    return resolvedCells.has(`${row}-${col}`);
}

function escapeHtml(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to animate error state transition
function updateCellWithErrorAnimation(targetCell, newHtml, delay = 0, row, col) {
    if (!targetCell) {
        return false;
    }
    
    const cellKey = `${row}-${col}`;
    const loadingElement = targetCell.querySelector('.guid-loading');
    if (loadingElement) {
        // Mark this cell as animating during the error animation process
        animatingCells.add(cellKey);
        
        // Mark this cell as being processed to avoid double-processing
        if (loadingElement.dataset.fading === 'true') {
            return false; // Already being processed
        }
        loadingElement.dataset.fading = 'true';
        
        // Add delay before starting the error animation
        setTimeout(() => {
            // Double-check the element still exists
            const currentLoadingElement = targetCell.querySelector('.guid-loading');
            if (currentLoadingElement && !currentLoadingElement.classList.contains('error-animation')) {
                // Add error animation class to trigger red color transition and pulse
                currentLoadingElement.classList.add('error-animation');
                
                // Wait for error animation to complete, then fade out
                setTimeout(() => {
                    // Add fade-out class after error animation
                    if (currentLoadingElement && currentLoadingElement.classList.contains('error-animation')) {
                        currentLoadingElement.classList.add('fade-out');
                        
                        // Start content replacement early in the fade-out for seamless transition
                        setTimeout(() => {
                            const fadedElement = targetCell.querySelector('.guid-loading.fade-out');
                            if (fadedElement) {
                                const cleanHtml = newHtml.replace('__HTML__', '');
                                targetCell.innerHTML = cleanHtml;
                                
                                // Add fade-in animation to the new content immediately
                                const newContent = targetCell.querySelector('.resolved-identity, .error-cell');
                                if (newContent) {
                                    newContent.classList.add('fade-in-content');
                                }
                            }
                            // Remove from animating cells set
                            markCellNotAnimating(row, col);
                        }, 200); // Start content replacement halfway through fade-out
                    } else {
                        // Animation was interrupted, remove from tracking
                        markCellNotAnimating(row, col);
                    }
                }, 300); // Reduced from 600ms to match faster timing
            } else {
                // Animation was interrupted, remove from tracking
                markCellNotAnimating(row, col);
            }
        }, delay);
        
        return true;
    } else {
        // No loading animation, update immediately (but still respect delay)
        setTimeout(() => {
            const cleanHtml = newHtml.replace('__HTML__', '');
            targetCell.innerHTML = cleanHtml;
        }, delay);
        return false;
    }
}

// Helper function to smoothly transition from loading animation to resolved content
function updateCellWithFade(targetCell, newHtml, delay = 0, row, col) {
    if (!targetCell) {
        return false;
    }
    
    const cellKey = `${row}-${col}`;
    const loadingElement = targetCell.querySelector('.guid-loading');
    if (loadingElement) {
        // Mark this cell as animating during the fade process
        animatingCells.add(cellKey);
        
        // Mark this cell as being processed to avoid double-processing
        if (loadingElement.dataset.fading === 'true') {
            return false; // Already fading
        }
        loadingElement.dataset.fading = 'true';
        
        // Add delay before starting the fade-out
        setTimeout(() => {
            // Double-check the element still exists and isn't already faded
            const currentLoadingElement = targetCell.querySelector('.guid-loading');
            if (currentLoadingElement && !currentLoadingElement.classList.contains('fade-out')) {
                // Add fade-out class to trigger animation
                currentLoadingElement.classList.add('fade-out');
                
                // Replace content right as fade-out completes for seamless transition
                setTimeout(() => {
                    // Final check - only replace if the fade-out element is still there
                    const fadedElement = targetCell.querySelector('.guid-loading.fade-out');
                    if (fadedElement) {
                        const cleanHtml = newHtml.replace('__HTML__', '');
                        targetCell.innerHTML = cleanHtml;
                        
                        // Add fade-in animation to the new content immediately
                        const newContent = targetCell.querySelector('.resolved-identity, .error-cell');
                        if (newContent) {
                            newContent.classList.add('fade-in-content');
                        }
                    }
                    // Remove from animating cells set
                    markCellNotAnimating(row, col);
                }, 400); // Replace content right as fade-out completes (0.4s)
            } else {
                // Animation was interrupted, remove from tracking
                markCellNotAnimating(row, col);
            }
        }, delay);
        
        return true;
    } else {
        // No loading animation, update immediately (but still respect delay)
        setTimeout(() => {
            const cleanHtml = newHtml.replace('__HTML__', '');
            targetCell.innerHTML = cleanHtml;
        }, delay);
        return true;
    }
}

function getFriendlyTypeName(objectType) {
    switch (objectType) {
        case 'users':
            return 'Users';
        case 'servicePrincipals':
            return 'Service Principals';
        case 'groups':
            return 'Groups';
        default:
            return objectType || 'Unknown';
    }
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${month} ${day}, ${year}, ${hours}:${minutes}:${seconds}`;
}

function formatCellValue(cell) {
    if (cell === null || cell === undefined) {
        return { displayValue: '<em style="color: var(--vscode-descriptionForeground);">null</em>', tooltipValue: 'null' };
    }

    // Check if this is already formatted HTML (marked with special prefix)
    if (typeof cell === 'string' && cell.startsWith('__HTML__')) {
        const htmlContent = cell.substring(8); // Remove the __HTML__ prefix
        
        // Extract custom tooltip content if it exists
        const tooltipMatch = htmlContent.match(/data-tooltip="([^"]+)"/);
        let tooltipValue;
        if (tooltipMatch) {
            // Decode the tooltip content
            tooltipValue = tooltipMatch[1].replace(/&quot;/g, '"');
        } else {
            // Fallback: strip HTML for tooltip
            tooltipValue = htmlContent.replace(/<[^>]*>/g, '');
        }
        
        return {
            displayValue: htmlContent, // Don't escape HTML for these special cases
            tooltipValue: tooltipValue
        };
    }

    // Check if this is already formatted HTML (for loading spinners and resolved identities)
    if (typeof cell === 'string' && (cell.includes('<div class="guid-loading">') || cell.includes('<span class="resolved-identity">') || cell.includes('<em style="color:'))) {
        return {
            displayValue: cell, // Don't escape HTML for these special cases
            tooltipValue: cell.replace(/<[^>]*>/g, '') // Strip HTML for tooltip
        };
    }

    if (typeof cell === 'object') {
        try {
            // Format JSON with proper indentation for tooltip
            const jsonString = JSON.stringify(cell, null, 2);

            // Create a compact display version for the cell
            const compactJson = JSON.stringify(cell);

            // Truncate display if too long
            const maxDisplayLength = 100;
            let displayValue = compactJson.length > maxDisplayLength
                ? compactJson.substring(0, maxDisplayLength) + '...'
                : compactJson;

            // Add JSON styling
            displayValue = '<span class="json-content">' + escapeHtml(displayValue) + '</span>';

            return {
                displayValue: displayValue,
                tooltipValue: jsonString
            };
        } catch (error) {
            // If JSON.stringify fails, fall back to string conversion
            const stringValue = String(cell);
            return {
                displayValue: escapeHtml(stringValue),
                tooltipValue: stringValue
            };
        }
    }

    // For non-object values, use as-is
    const stringValue = String(cell);
    return {
        displayValue: escapeHtml(stringValue),
        tooltipValue: stringValue
    };
}

function displayResults(result, preserveDetailsPane = false) {
    currentResults = result;

    // Close details pane when new query results are displayed, unless preserving it
    if (!preserveDetailsPane && selectedDetailRowIndices.length > 0) {
        closeDetails();
    }

    // Reset resolved columns and cells when new query results come in (unless preserving details pane)
    if (!preserveDetailsPane) {
        resolvedColumns.clear();
        resolvedCells.clear();
    }

    const tableContainer = document.getElementById('tableContainer');
    const resultsInfo = document.getElementById('resultsInfo');
    const exportBtn = document.getElementById('exportBtn');

    if (!result.columns || !result.data || result.data.length === 0) {
        tableContainer.innerHTML = '<div class="no-results">No results found.</div>';
        resultsInfo.textContent = 'No results.';
        exportBtn.style.display = 'none';
        return;
    }

    const executionTimeText = result.executionTimeMs ?
        ' • ' + result.executionTimeMs + 'ms' : '';
    resultsInfo.textContent = result.totalRecords + ' results' + executionTimeText + ' • ' + formatTimestamp(result.timestamp);
    exportBtn.style.display = 'block';

    let tableHtml = '<table class="results-table"><thead><tr>';

    // Add details button column header
    tableHtml += '<th class="detail-button-cell select-all-header" style="width: 36px; cursor: pointer; text-align: center; padding: 0;" title="Click to select/deselect all rows" draggable="false" ondragstart="return false;" onclick="toggleSelectAllRows()">' +
        '<svg viewBox="0 0 16 16" style="width: 18px; height: 18px; fill: var(--vscode-descriptionForeground); opacity: 0.7; vertical-align: middle; margin: 0; transition: all 0.2s ease;">' +
        '<circle cx="6.5" cy="6.5" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="m9.5 9.5 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        '</svg>' +
        '</th>';

    result.columns.forEach((col, index) => {
        const sortClass = sortState.column === index ?
            (sortState.direction === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
        
        // Get column data for GUID detection
        const columnData = result.data.map(row => row[index]);
        const showResolveBtn = shouldShowResolveButton(col.name, columnData) && !isColumnResolvedOrHasResolvedVersion(index);
        
        tableHtml += '<th class="' + sortClass + '" ' +
            'draggable="true" ' +
            'data-col-index="' + index + '" ' +
            'onclick="handleHeaderClick(event, ' + index + ')" ' +
            'ondragstart="handleDragStart(event, ' + index + ')"' +
            'ondragover="handleDragOver(event)"' +
            'ondrop="handleDrop(event, ' + index + ')"' +
            'ondragend="handleDragEnd(event)"' +
            'style="width: ' + (col.width || 'auto') + '; position: relative;"' +
            'title="' + col.name + '">' +
            '<span class="header-text">' + col.name + '</span>';
        
        // Add resolve button if this is a GUID column
        if (showResolveBtn) {
            tableHtml += '<button class="resolve-guid-btn" onclick="showResolveMenu(event, ' + index + ', \'' + 
                col.name + '\')" title="Resolve GUIDs in this column" style="' +
                'position: absolute; right: 24px; top: 50%; transform: translateY(-50%); ' +
                'background: none; border: none; cursor: pointer; padding: 4px; ' +
                'color: var(--vscode-descriptionForeground); opacity: 0.7; ' +
                'transition: opacity 0.2s ease; border-radius: 2px;">' +
                '<svg viewBox="0 0 16 16" style="width: 14px; height: 14px; fill: currentColor;">' +
                '<rect x="1" y="6" width="6" height="4" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
                '<rect x="6" y="7" width="4" height="2" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
                '<rect x="9" y="7.5" width="3" height="1" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
                '<line x1="12" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                '<circle cx="3.5" cy="8" r="1" fill="none" stroke="currentColor" stroke-width="1"/>' +
                '</svg></button>';
        }
        
        tableHtml += '<div class="resize-handle" onmousedown="startResize(event, ' + index + ')"></div>' +
            '</th>';
    });

    tableHtml += '</tr></thead><tbody>';

    result.data.forEach((row, rowIndex) => {
        tableHtml += '<tr>';

        // Add details button cell  
        const isSelected = selectedDetailRowIndices.includes(rowIndex);
        const circleIcon = isSelected ?
            '<circle cx="8" cy="8" r="5" fill="currentColor"/>' :
            '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="2"/>';

        tableHtml += '<td class="detail-button-cell">' +
            '<button class="detail-button' + (isSelected ? ' active' : '') + '" onclick="showRowDetails(' + rowIndex + ')" title="View row details">' +
            '<svg viewBox="0 0 16 16">' +
            circleIcon +
            '</svg>' +
            '</button>' +
            '</td>';

        row.forEach((cell, cellIndex) => {
            const { displayValue, tooltipValue } = formatCellValue(cell);
            // Store tooltip data as data attribute - tooltipValue is already safe
            tableHtml += '<td data-tooltip="' + tooltipValue.replace(/"/g, '&quot;') + '" ' +
                'onclick="selectCell(this, ' + rowIndex + ', ' + cellIndex + ')" ' +
                'onmousedown="startCellDrag(event, this, ' + rowIndex + ', ' + cellIndex + ')"' +
                'onmouseenter="handleCellDragEnter(event, this, ' + rowIndex + ', ' + cellIndex + ')" ' +
                'onmouseleave="hideCustomTooltipDelayed()" ' +
                'data-row="' + rowIndex + '" ' +
                'data-col="' + cellIndex + '">' + displayValue + '</td>';
        });
        tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table>';
    tableContainer.innerHTML = tableHtml;

    // Add context menu event listener to the table
    const table = tableContainer.querySelector('.results-table');
    if (table) {
        table.addEventListener('contextmenu', handleTableContextMenu);
    }

    // Update detail button states after table regeneration
    setTimeout(() => {
        updateDetailButtonStates();
    }, 0);
}

// Loading indicator functionality
const loadingMessages = [
    "Finding Azure treasures...",
    "Sailing the cloudy seas...",
    "Mapping uncharted resources…",
    "Charting resource providers...",
    "Plundering key vaults...",
    "Investigating secrets...",
    "Exploring landing zones...",
    "Following effective routes...",
    "Opening route maps...",
    "Digging for hidden properties...",
    "Navigating configuration drift..."
];

function getRandomLoadingMessage() {
    return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
}

function showLoadingIndicator() {
    const contentWrapper = document.getElementById('contentWrapper');
    if (!contentWrapper) return;

    // Check if loading overlay already exists
    const existingOverlay = document.getElementById('loadingOverlay');
    if (existingOverlay) {
        return; // Don't recreate if already showing
    }

    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.id = 'loadingOverlay';

    const randomMessage = getRandomLoadingMessage();

    // Create elements for Lottie animation
    const loadingContent = document.createElement('div');
    loadingContent.className = 'loading-content';
    
    const loadingAnimation = document.createElement('div');
    loadingAnimation.className = 'loading-animation';
    loadingAnimation.id = 'lottie-loading-container';
    
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'loading-message';
    loadingMessage.textContent = randomMessage;
    
    loadingContent.appendChild(loadingAnimation);
    loadingContent.appendChild(loadingMessage);
    loadingOverlay.appendChild(loadingContent);

    contentWrapper.style.position = 'relative';
    contentWrapper.appendChild(loadingOverlay);

    // Create Lottie animation
    if (window.createLoadingAnimation) {
        try {
            const animation = window.createLoadingAnimation(loadingAnimation);
            
            // Store animation reference for cleanup
            loadingOverlay._lottieAnimation = animation;
        } catch (error) {
            console.error('Failed to create Lottie animation:', error);
        }
    } else {
        console.warn('Lottie bundle not loaded');
    }
}

function hideLoadingIndicator() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        // Clean up Lottie animation if it exists
        if (loadingOverlay._lottieAnimation) {
            try {
                loadingOverlay._lottieAnimation.destroy();
            } catch (error) {
                console.warn('Error cleaning up Lottie animation:', error);
            }
        }
        loadingOverlay.remove();
    }
}

// Custom tooltip functionality
let customTooltip = null;
let tooltipTimeout = null;
let hideTooltipTimeout = null;

function createTooltip() {
    if (!customTooltip) {
        customTooltip = document.createElement('div');
        customTooltip.className = 'custom-tooltip';

        // Add mouse events to tooltip for interactivity
        customTooltip.addEventListener('mouseenter', function () {
            // Cancel any pending hide when mouse enters tooltip
            if (hideTooltipTimeout) {
                clearTimeout(hideTooltipTimeout);
                hideTooltipTimeout = null;
            }
        });

        customTooltip.addEventListener('mouseleave', function (e) {
            // Don't hide tooltip if mouse is moving to the context menu
            // Check if the related target (where mouse is going) is the context menu
            if (contextMenuVisible && customContextMenu &&
                (customContextMenu.contains(e.relatedTarget) || e.relatedTarget === customContextMenu)) {
                return;
            }

            // Hide tooltip when mouse leaves tooltip
            hideCustomTooltipDelayed();
        });

        // Custom context menu for tooltip with just Copy option
        customTooltip.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // Only show context menu if there's text selected in the tooltip
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                showTooltipContextMenu(e);
            }
        });

        document.body.appendChild(customTooltip);
    }
    return customTooltip;
}

function showCustomTooltip(event, element) {
    // Don't show tooltip if context menu is visible
    if (contextMenuVisible) {
        return;
    }

    const tooltip = createTooltip();
    const tooltipText = element.getAttribute('data-tooltip');

    if (!tooltipText || tooltipText.trim() === '') {
        // Don't show tooltip if content is empty
        hideCustomTooltip();
        return;
    }

    // Clear any existing timeouts
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
    }
    if (hideTooltipTimeout) {
        clearTimeout(hideTooltipTimeout);
        hideTooltipTimeout = null;
    }

    tooltip.textContent = tooltipText;

    // Add JSON class if content looks like JSON
    if (tooltipText.trim().startsWith('{') || tooltipText.trim().startsWith('[')) {
        tooltip.classList.add('json');
    } else {
        tooltip.classList.remove('json');
    }

    // Position tooltip anchored to the cell, not cursor
    positionTooltipToCell(element, tooltip);

    // Show tooltip immediately
    tooltip.classList.add('show');

    // Check if tooltip has scrollable content (vertical or horizontal) and make it interactive
    setTimeout(() => {
        const hasVerticalScroll = tooltip.scrollHeight > tooltip.clientHeight;
        const hasHorizontalScroll = tooltip.scrollWidth > tooltip.clientWidth;

        if (hasVerticalScroll || hasHorizontalScroll) {
            tooltip.classList.add('interactive');
        } else {
            tooltip.classList.remove('interactive');
        }
    }, 0);
}

function positionTooltipToCell(cellElement, tooltip) {
    // Get cell dimensions and position
    const cellRect = cellElement.getBoundingClientRect();
    const offset = 2; // Smaller offset for tighter positioning

    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Set initial position to measure tooltip dimensions
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';

    // Get tooltip dimensions after it's rendered
    const tooltipRect = tooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width;
    const tooltipHeight = tooltipRect.height;

    // Reset visibility
    tooltip.style.visibility = 'visible';

    // Calculate primary anchor point: right 10% of cell horizontally, top of cell vertically
    const rightAnchorX = cellRect.left + (cellRect.width * 0.90);
    const anchorY = cellRect.top;

    // Try positioning tooltip's top-left corner at the right anchor point first
    let left = rightAnchorX + offset;
    let top = anchorY;

    // Check if tooltip would go off-screen to the right
    if (left + tooltipWidth > viewportWidth - offset) {
        // Position to the left using left 10% anchor point
        const leftAnchorX = cellRect.left + (cellRect.width * 0.1);
        left = leftAnchorX - tooltipWidth - offset;
    }

    // Final fallback: ensure tooltip doesn't go off-screen to the left
    if (left < offset) {
        left = offset;
    }

    // Adjust vertical position if tooltip would go off-screen
    if (top < offset) {
        top = offset;
    } else if (top + tooltipHeight > viewportHeight - offset) {
        top = viewportHeight - tooltipHeight - offset;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function hideCustomTooltip() {
    if (customTooltip) {
        customTooltip.classList.remove('show');
        customTooltip.classList.remove('interactive');

        // Remove tooltip after transition
        tooltipTimeout = setTimeout(() => {
            if (customTooltip && !customTooltip.classList.contains('show')) {
                customTooltip.textContent = '';
            }
        }, 150); // Match transition duration
    }
}

function hideCustomTooltipDelayed() {
    // Don't hide tooltip if context menu is visible
    if (contextMenuVisible) {
        return;
    }

    // Add a small delay to allow mouse to move from cell to tooltip
    hideTooltipTimeout = setTimeout(() => {
        hideCustomTooltip();
    }, 100);
}

// Tooltip context menu functionality
let tooltipContextMenu = null;
let storedTooltipSelection = null; // Store the selection text when right-clicking

function showTooltipContextMenu(event) {
    // Store the current selection before any menu operations
    const selection = window.getSelection();
    storedTooltipSelection = selection && selection.toString().length > 0 ? selection.toString() : null;

    // Hide any existing context menus
    hideContextMenu();
    hideTooltipContextMenu();

    const tooltipMenu = createTooltipContextMenu();
    positionContextMenu(event, tooltipMenu);

    // Set the context menu as visible
    contextMenuVisible = true;

    // Add event listeners to hide menu when clicking outside or pressing Escape
    setTimeout(() => {
        document.addEventListener('click', hideTooltipContextMenu, { once: true });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideTooltipContextMenu();
            }
        }, { once: true });
    }, 0);
}

function createTooltipContextMenu() {
    // Remove existing tooltip menu if any
    if (tooltipContextMenu) {
        document.body.removeChild(tooltipContextMenu);
    }

    tooltipContextMenu = document.createElement('div');
    tooltipContextMenu.className = 'custom-context-menu';

    // Prevent clicks on the menu itself from closing it
    tooltipContextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Handle mouse leave from context menu
    tooltipContextMenu.addEventListener('mouseleave', (e) => {
        // If mouse is going back to tooltip, don't hide anything
        if (customTooltip && customTooltip.contains(e.relatedTarget)) {
            return;
        }

        // If mouse is going somewhere else, hide the tooltip after a short delay
        setTimeout(() => {
            if (!contextMenuVisible) {
                hideCustomTooltipDelayed();
            }
        }, 50);
    });

    // Copy option for selected text in tooltip
    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item';
    copyItem.innerHTML = '<span>Copy</span>';
    copyItem.addEventListener('click', () => {
        copyTooltipSelection();
        hideTooltipContextMenu();
    });

    tooltipContextMenu.appendChild(copyItem);
    document.body.appendChild(tooltipContextMenu);

    return tooltipContextMenu;
}

function hideTooltipContextMenu() {
    if (tooltipContextMenu) {
        document.body.removeChild(tooltipContextMenu);
        tooltipContextMenu = null;
    }
    // Reset context menu visibility flag
    contextMenuVisible = false;
}

function copyTooltipSelection() {
    // Use the stored selection from when the context menu was opened
    const selectedText = storedTooltipSelection;

    if (selectedText && selectedText.length > 0) {
        // Copy to clipboard
        navigator.clipboard.writeText(selectedText).then(() => {
            // Clear the stored selection
            storedTooltipSelection = null;
            // Hide the tooltip context menu since we've completed the action
            hideTooltipContextMenu();
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = selectedText;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);

            // Clear stored selection and hide menu
            storedTooltipSelection = null;
            hideTooltipContextMenu();
        });
    }
}

// Cell selection functionality
let selectedCells = new Set();
let isSelecting = false;
let selectionStart = null;
let isDragging = false;
let dragStartCell = null;
let dragCurrentCell = null;

function selectCell(cellElement, row, col) {
    // Don't handle click if we just finished a drag operation
    if (isDragging) {
        return;
    }

    if (event.ctrlKey || event.metaKey) {
        // Ctrl/Cmd click for multi-select
        toggleCellSelection(cellElement, row, col);
    } else if (event.shiftKey && selectionStart) {
        // Shift click for range selection
        selectRange(selectionStart.row, selectionStart.col, row, col);
    } else {
        // Regular click - clear previous selection and select this cell
        clearSelection();
        toggleCellSelection(cellElement, row, col);
        selectionStart = { row, col };
    }
}

function toggleCellSelection(cellElement, row, col) {
    const cellKey = row + '-' + col;
    if (selectedCells.has(cellKey)) {
        selectedCells.delete(cellKey);
        cellElement.classList.remove('selected');
    } else {
        selectedCells.add(cellKey);
        cellElement.classList.add('selected');
    }
}

function selectRange(startRow, startCol, endRow, endCol) {
    clearSelection();

    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const cellElement = document.querySelector('td[data-row="' + r + '"][data-col="' + c + '"]');
            if (cellElement) {
                const cellKey = r + '-' + c;
                selectedCells.add(cellKey);
                cellElement.classList.add('selected');
            }
        }
    }
}

function clearSelection() {
    selectedCells.clear();
    document.querySelectorAll('.results-table td.selected').forEach(cell => {
        cell.classList.remove('selected');
    });
}

// Drag selection functionality
function startCellDrag(event, cellElement, row, col) {
    // Don't start drag if it's a right-click (we want context menu)
    if (event.button === 2) {
        return;
    }

    // Prevent text selection during drag
    event.preventDefault();
    document.body.style.userSelect = 'none';

    isDragging = true;
    dragStartCell = { row, col, element: cellElement };
    dragCurrentCell = { row, col, element: cellElement };

    // Clear previous selection if not using Ctrl/Cmd
    if (!event.ctrlKey && !event.metaKey) {
        clearSelection();
    }

    // Select the starting cell
    toggleCellSelection(cellElement, row, col);
    selectionStart = { row, col };

    // Add document-level mouse up listener to end drag
    document.addEventListener('mouseup', endCellDrag, { once: true });

    // Prevent the default click handler from firing
    event.stopPropagation();
}

function handleCellDragEnter(event, cellElement, row, col) {
    // Only handle tooltip if we're not dragging
    if (!isDragging) {
        showCustomTooltip(event, cellElement);
        return;
    }

    // Handle drag selection
    if (isDragging && dragStartCell) {
        dragCurrentCell = { row, col, element: cellElement };

        // Clear current selection (but keep Ctrl/Cmd behavior)
        if (!event.ctrlKey && !event.metaKey) {
            clearSelection();
        }

        // Select range from start to current cell
        selectRange(dragStartCell.row, dragStartCell.col, row, col);
    }
}

function endCellDrag(event) {
    if (isDragging) {
        isDragging = false;
        dragStartCell = null;
        dragCurrentCell = null;

        // Re-enable text selection
        document.body.style.userSelect = '';
    }
}

// Custom context menu functionality
let customContextMenu = null;
let rightClickedCell = null; // Track the cell that was right-clicked
let contextMenuVisible = false; // Track if context menu is showing

function handleTableContextMenu(event) {
    event.preventDefault();

    // Find the cell that was right-clicked
    const target = event.target.closest('td');

    if (!target) return;

    // Get row and column from data attributes
    const rowAttr = target.getAttribute('data-row');
    const colAttr = target.getAttribute('data-col');

    if (rowAttr === null || colAttr === null) return;

    const row = parseInt(rowAttr);
    const col = parseInt(colAttr);

    if (isNaN(row) || isNaN(col)) return;

    // Store the right-clicked cell info
    rightClickedCell = {
        element: target,
        row: row,
        col: col
    };

    // Smart selection logic
    const cellKey = row + '-' + col;
    const isRightClickedCellSelected = selectedCells.has(cellKey);

    if (selectedCells.size <= 1) {
        // If we have 0 or 1 cells selected, select the right-clicked cell
        selectCell(target, row, col);
    } else if (selectedCells.size > 1 && !isRightClickedCellSelected) {
        // If we have multiple cells selected but right-clicked outside the selection,
        // clear selection and select just the right-clicked cell
        clearSelection();
        selectCell(target, row, col);
    }
    // If multiple cells selected and right-clicked on one of them, keep current selection

    // Hide tooltip and its context menu when showing cell context menu
    hideCustomTooltip();
    hideTooltipContextMenu();

    // Hide any existing cell context menu
    if (customContextMenu) {
        document.body.removeChild(customContextMenu);
        customContextMenu = null;
    }

    // Create context menu
    const contextMenu = createContextMenu();

    // Position and show context menu
    positionContextMenu(event, contextMenu);

    // Set flag that context menu is visible
    contextMenuVisible = true;

    // Add click outside listener to close menu
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
        document.addEventListener('keydown', handleContextMenuKeydown, { once: true });
    }, 0);
}

function handleContextMenuKeydown(event) {
    if (event.key === 'Escape') {
        hideContextMenu();
    }
}

// Context menu handler for details pane
function handleDetailsContextMenu(event) {
    event.preventDefault();

    // Hide tooltip and its context menu when showing details context menu
    hideCustomTooltip();
    hideTooltipContextMenu();

    // Hide any existing context menu
    if (customContextMenu) {
        document.body.removeChild(customContextMenu);
        customContextMenu = null;
    }

    // Reset right-clicked cell since we're in details pane context
    rightClickedCell = null;

    // Check if there's text selected
    const clickedElement = event.target;
    const selection = window.getSelection();
    const hasTextSelection = selection && selection.toString().trim().length > 0;

    // If there's text selection, always use the text selection context menu
    if (hasTextSelection) {
        const contextMenu = createDetailsContextMenu();
        positionContextMenu(event, contextMenu);
        contextMenuVisible = true;
        setTimeout(() => {
            document.addEventListener('click', hideContextMenu, { once: true });
            document.addEventListener('keydown', handleContextMenuKeydown, { once: true });
        }, 0);
        return;
    }

    // Check if we're right-clicking on a comparison cell (only when no text is selected)
    const comparisonCell = clickedElement.closest('.comparison-cell');
    if (comparisonCell) {
        // Handle comparison cell context menu
        handleComparisonCellContextMenu(event, comparisonCell);
        return;
    }

    // Check if we're right-clicking on a property box
    const propertyElement = clickedElement.closest('.json-property');
    let contextMenu;
    if (propertyElement) {
        // Right-clicked on a property box without text selection
        contextMenu = createPropertyContextMenu(propertyElement);
    } else {
        // Right-clicked on general area without text selection
        contextMenu = createDetailsContextMenu();
    }

    // Position and show context menu
    positionContextMenu(event, contextMenu);

    // Set flag that context menu is visible
    contextMenuVisible = true;

    // Add click outside listener to close menu
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
        document.addEventListener('keydown', handleContextMenuKeydown, { once: true });
    }, 0);
}

function createContextMenu() {
    if (customContextMenu) {
        document.body.removeChild(customContextMenu);
    }

    customContextMenu = document.createElement('div');
    customContextMenu.className = 'custom-context-menu';

    // Prevent clicks on the menu itself from closing it
    customContextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Check if we have a valid right-clicked cell
    let hasValidRightClick = false;
    let hasJsonCell = false;
    let rightClickedCellKey = null;
    let cellIsNull = false;
    let isGuidCell = false; // Track if this is a GUID cell that can be resolved
    let isErrorCell = false; // Track if this is an error cell
    let isResolvedCell = false; // Track if this is a resolved identity cell

    if (rightClickedCell && currentResults && currentResults.data) {
        const { row, col } = rightClickedCell;

        if (currentResults.data[row] && currentResults.data[row][col] !== undefined) {
            const cellValue = currentResults.data[row][col];
            cellIsNull = cellValue === null || cellValue === undefined;
            hasValidRightClick = !cellIsNull; // Only valid if not null
            rightClickedCellKey = row + '-' + col;
            
            // Check for JSON objects (not resolved identity cells)
            if (typeof cellValue === 'object' && cellValue !== null) {
                hasJsonCell = true;
            } else if (typeof cellValue === 'string' && cellValue.startsWith('__HTML__') && cellValue.includes('resolved-identity')) {
                // This is a resolved identity cell
                isResolvedCell = true;
                
                // Check if this is an error cell
                if (cellValue.includes('error-cell')) {
                    isErrorCell = true;
                    // Error resolved cells should not be treated as JSON cells for copy formatting
                    hasJsonCell = false;
                } else {
                    // Successfully resolved cells should be treated as JSON cells for copy formatting
                    hasJsonCell = true;
                }
            }
            
            // Check if this is a GUID that can be resolved
            if (typeof cellValue === 'string' && !cellValue.startsWith('__HTML__') && currentResults.columns[col]) {
                const columnName = currentResults.columns[col].name;
                const columnData = currentResults.data.map(row => row[col]);
                if (shouldShowResolveButton(columnName, columnData) && isGuid(cellValue) && 
                    !isColumnResolvedOrHasResolvedVersion(col) && !isCellIndividuallyResolved(row, col)) {
                    isGuidCell = true;
                }
            }
        }
    }

    // Check if right-clicked cell is part of current selection
    const hasSelection = selectedCells.size > 0;
    const rightClickedSelectedCell = hasSelection && rightClickedCellKey && selectedCells.has(rightClickedCellKey);

    // Check if any selected cells contain JSON (for formatted copy option)
    let hasSelectedJsonCells = false;
    if (hasSelection) {
        selectedCells.forEach(cellKey => {
            const [row, col] = cellKey.split('-').map(Number);
            if (currentResults && currentResults.data && currentResults.data[row] && currentResults.data[row][col] !== undefined) {
                const cellValue = currentResults.data[row][col];
                if (typeof cellValue === 'object' && cellValue !== null) {
                    hasSelectedJsonCells = true;
                }
            }
        });
    }

    // Copy single cell option (disabled if cell is null OR if multiple cells are selected)
    let copyItem = null;
    const hasMultipleSelected = rightClickedSelectedCell && hasSelection && selectedCells.size > 1;

    // Only show single cell copy if we don't have multiple cells selected
    if (!hasMultipleSelected) {
        copyItem = document.createElement('div');
        copyItem.className = 'context-menu-item ' + (hasValidRightClick ? '' : 'disabled');
        copyItem.innerHTML = '<span>Copy</span>';
        copyItem.addEventListener('click', () => {
            if (hasValidRightClick) {
                copyRightClickedCell();
                hideContextMenu();
            }
        });
    }

    // Copy selection option (only if right-clicked on a selected cell and there are multiple selected)
    let copySelectionItem = null;
    if (rightClickedSelectedCell && hasSelection && selectedCells.size > 1) {
        copySelectionItem = document.createElement('div');
        copySelectionItem.className = 'context-menu-item';
        copySelectionItem.innerHTML = '<span>Copy Selection (' + selectedCells.size + ' cells)</span>';
        copySelectionItem.addEventListener('click', () => {
            copySelectedCells();
            hideContextMenu();
        });
    }

    // Copy with headers option (only if right-clicked on a selected cell with multiple selections)
    let copyWithHeadersItem = null;
    if (rightClickedSelectedCell && hasSelection && selectedCells.size > 1) {
        copyWithHeadersItem = document.createElement('div');
        copyWithHeadersItem.className = 'context-menu-item';
        copyWithHeadersItem.innerHTML = '<span>Copy Selection with Headers</span>';
        copyWithHeadersItem.addEventListener('click', () => {
            copySelectedCellsWithHeaders();
            hideContextMenu();
        });
    }

    // Copy formatted option for single cell (only show if right-clicked cell contains JSON AND not in multi-selection context)
    let copyFormattedItem = null;
    if (hasJsonCell && !(rightClickedSelectedCell && selectedCells.size > 1)) {
        copyFormattedItem = document.createElement('div');
        copyFormattedItem.className = 'context-menu-item';
        copyFormattedItem.innerHTML = '<span>Copy Data Formatted</span>';
        copyFormattedItem.addEventListener('click', () => {
            copyRightClickedCellFormatted();
            hideContextMenu();
        });
    }

    // Copy compressed option for single cell (only show if right-clicked cell contains JSON AND not in multi-selection context)
    let copyCompressedItem = null;
    if (hasJsonCell && !(rightClickedSelectedCell && selectedCells.size > 1)) {
        copyCompressedItem = document.createElement('div');
        copyCompressedItem.className = 'context-menu-item';
        copyCompressedItem.innerHTML = '<span>Copy Data Compressed</span>';
        copyCompressedItem.addEventListener('click', () => {
            copyRightClickedCellCompressed();
            hideContextMenu();
        });
    }

    // Copy selection formatted option - REMOVED per user request
    // Don't show formatted option for multi-cell selections
    let copySelectionFormattedItem = null;

    // Resolve GUID option - enhanced to handle multiple cell selection
    let resolveGuidItem = null;
    let canResolveSelection = false;
    let selectedColumn = null;
    let selectedGuidCells = [];
    
    // Check if we have multiple selected cells from the same column that can be resolved
    if (rightClickedSelectedCell && hasSelection && selectedCells.size > 1) {
        // Get all selected cell coordinates
        const selectedCoords = Array.from(selectedCells).map(cellKey => {
            const [row, col] = cellKey.split('-').map(Number);
            return { row, col, cellKey };
        });
        
        // Check if all selected cells are from the same column
        const columns = new Set(selectedCoords.map(coord => coord.col));
        if (columns.size === 1) {
            selectedColumn = selectedCoords[0].col;
            
            // Check if this column can be resolved and collect valid GUID cells
            if (currentResults && currentResults.columns[selectedColumn]) {
                const columnName = currentResults.columns[selectedColumn].name;
                const columnData = currentResults.data.map(row => row[selectedColumn]);
                
                if (shouldShowResolveButton(columnName, columnData) && !isColumnResolvedOrHasResolvedVersion(selectedColumn)) {
                    selectedCoords.forEach(({ row, col }) => {
                        const cellValue = currentResults.data[row][col];
                        if (typeof cellValue === 'string' && !cellValue.startsWith('__HTML__') && 
                            isGuid(cellValue) && !isCellIndividuallyResolved(row, col)) {
                            selectedGuidCells.push({ row, col });
                        }
                    });
                    
                    canResolveSelection = selectedGuidCells.length > 0;
                }
            }
        }
    }
    
    // Single cell resolution (existing logic)
    if (isGuidCell && hasValidRightClick && !hasMultipleSelected) {
        resolveGuidItem = document.createElement('div');
        resolveGuidItem.className = 'context-menu-item';
        resolveGuidItem.innerHTML = '<span>Resolve as Identity</span>';
        resolveGuidItem.addEventListener('click', () => {
            resolveSingleGuid(rightClickedCell.row, rightClickedCell.col);
            hideContextMenu();
        });
    }
    // Multi-cell resolution for same column
    else if (canResolveSelection && selectedGuidCells.length > 0) {
        resolveGuidItem = document.createElement('div');
        resolveGuidItem.className = 'context-menu-item';
        const cellCount = selectedGuidCells.length;
        resolveGuidItem.innerHTML = `<span>Resolve as Identity (${cellCount} cell${cellCount > 1 ? 's' : ''})</span>`;
        resolveGuidItem.addEventListener('click', () => {
            resolveMultipleGuids(selectedGuidCells, selectedColumn);
            hideContextMenu();
        });
    }

    // Add all menu items
    if (copyItem) {
        customContextMenu.appendChild(copyItem);
    }
    if (copySelectionItem) {
        customContextMenu.appendChild(copySelectionItem);
    }
    if (copyWithHeadersItem) {
        customContextMenu.appendChild(copyWithHeadersItem);
    }
    if (copyFormattedItem) {
        customContextMenu.appendChild(copyFormattedItem);
    }
    if (copyCompressedItem) {
        customContextMenu.appendChild(copyCompressedItem);
    }
    if (copySelectionFormattedItem) {
        customContextMenu.appendChild(copySelectionFormattedItem);
    }
    if (resolveGuidItem) {
        customContextMenu.appendChild(resolveGuidItem);
    }

    document.body.appendChild(customContextMenu);
    return customContextMenu;
}

function createDetailsContextMenu() {
    if (customContextMenu) {
        document.body.removeChild(customContextMenu);
    }

    customContextMenu = document.createElement('div');
    customContextMenu.className = 'custom-context-menu';

    // Prevent clicks on the menu itself from closing it
    customContextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Check if there's text selected in the details pane
    const selection = window.getSelection();
    const hasSelection = selection && selection.toString().trim().length > 0;
    const selectedText = hasSelection ? selection.toString() : '';

    // Copy option (copy selected text or indicate no selection)
    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item ' + (hasSelection ? '' : 'disabled');
    copyItem.innerHTML = '<span>Copy</span>';
    copyItem.addEventListener('click', () => {
        if (hasSelection) {
            copyDetailsSelection(selectedText);
            hideContextMenu();
        }
    });

    // Copy compressed option (if selected text appears to be JSON)
    let copyCompressedItem = null;
    if (hasSelection && isJsonString(selectedText)) {
        copyCompressedItem = document.createElement('div');
        copyCompressedItem.className = 'context-menu-item';
        copyCompressedItem.innerHTML = '<span>Copy Compressed</span>';
        copyCompressedItem.addEventListener('click', () => {
            copyDetailsSelectionCompressed(selectedText);
            hideContextMenu();
        });
    }

    // Add menu items
    customContextMenu.appendChild(copyItem);
    if (copyCompressedItem) {
        customContextMenu.appendChild(copyCompressedItem);
    }

    document.body.appendChild(customContextMenu);
    return customContextMenu;
}

// Create context menu for right-clicking on a property box
function createPropertyContextMenu(propertyElement) {
    if (customContextMenu) {
        document.body.removeChild(customContextMenu);
    }

    customContextMenu = document.createElement('div');
    customContextMenu.className = 'custom-context-menu';

    // Prevent clicks on the menu itself from closing it
    customContextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Extract the property value from the clicked element
    const valueElement = propertyElement.querySelector('.json-value');
    let propertyValue = '';
    
    if (valueElement) {
        // Handle different types of value elements
        if (valueElement.tagName === 'PRE') {
            // For object values that are in <pre> tags
            propertyValue = valueElement.textContent || valueElement.innerText;
        } else {
            // For string, number, boolean, null values
            propertyValue = valueElement.textContent || valueElement.innerText;
        }
    }

    // Copy option for property value
    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item';
    copyItem.innerHTML = '<span>Copy</span>';
    copyItem.addEventListener('click', () => {
        copyDetailsSelection(propertyValue);
        hideContextMenu();
    });

    // Copy compressed option (if property value is JSON)
    let copyCompressedItem = null;
    if (propertyValue && isJsonString(propertyValue)) {
        copyCompressedItem = document.createElement('div');
        copyCompressedItem.className = 'context-menu-item';
        copyCompressedItem.innerHTML = '<span>Copy Compressed</span>';
        copyCompressedItem.addEventListener('click', () => {
            copyDetailsSelectionCompressed(propertyValue);
            hideContextMenu();
        });
    }

    // Add menu items
    customContextMenu.appendChild(copyItem);
    if (copyCompressedItem) {
        customContextMenu.appendChild(copyCompressedItem);
    }

    document.body.appendChild(customContextMenu);
    return customContextMenu;
}

// Helper function to detect if a string is JSON
function isJsonString(str) {
    try {
        const parsed = JSON.parse(str);
        return (typeof parsed === 'object' && parsed !== null);
    } catch (e) {
        return false;
    }
}

// Copy selected text from details pane
function copyDetailsSelection(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        fallbackCopyTextToClipboard(text);
    });
}

// Copy selected text from details pane with JSON compression (single line)
function copyDetailsSelectionCompressed(text) {
    try {
        const parsed = JSON.parse(text);
        const compressed = JSON.stringify(parsed);
        navigator.clipboard.writeText(compressed).then(() => {
            // Copy successful - no feedback needed
        }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
            fallbackCopyTextToClipboard(compressed);
        });
    } catch (e) {
        // Fallback to regular copy if JSON parsing fails
        copyDetailsSelection(text);
    }
}

// Initialize context menu for details content
function initializeDetailsContextMenu() {
    const detailsContent = document.getElementById('detailsContent');
    if (detailsContent) {
        // Remove any existing listener to avoid duplicates
        detailsContent.removeEventListener('contextmenu', handleDetailsContextMenu);
        // Add the context menu handler
        detailsContent.addEventListener('contextmenu', handleDetailsContextMenu);
    }
}

function positionContextMenu(event, menu) {
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Set initial position to measure menu dimensions
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';

    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;

    // Calculate position
    let left = mouseX;
    let top = mouseY;

    // Adjust if menu would go off-screen
    if (left + menuWidth > viewportWidth) {
        left = mouseX - menuWidth;
    }

    if (top + menuHeight > viewportHeight) {
        top = mouseY - menuHeight;
    }

    // Ensure menu doesn't go off-screen
    left = Math.max(0, left);
    top = Math.max(0, top);

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.visibility = 'visible';
}

function hideContextMenu() {
    if (customContextMenu) {
        document.body.removeChild(customContextMenu);
        customContextMenu = null;
    }
    // Reset the right-clicked cell when menu is actually hidden
    rightClickedCell = null;
    // Reset context menu visibility flag
    contextMenuVisible = false;
    // Remove any lingering event listeners
    document.removeEventListener('keydown', handleContextMenuKeydown);
}

function copySelectedCellsWithHeaders() {
    if (selectedCells.size === 0) return;

    // Get all selected cells with their positions
    const cellData = [];
    selectedCells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        if (currentResults && currentResults.data[row] && currentResults.data[row][col] !== undefined) {
            cellData.push({
                row,
                col,
                value: currentResults.data[row][col] || ''
            });
        }
    });

    if (cellData.length === 0) return;

    // Sort by row then by column
    cellData.sort((a, b) => a.row - b.row || a.col - b.col);

    // Get unique columns and their headers
    const uniqueCols = [...new Set(cellData.map(cell => cell.col))].sort((a, b) => a - b);
    const headers = uniqueCols.map(colIndex => {
        return currentResults && currentResults.columns[colIndex]
            ? currentResults.columns[colIndex].name
            : 'Column ' + colIndex;
    });

    // Group by rows
    const rowGroups = {};
    cellData.forEach(cell => {
        if (!rowGroups[cell.row]) {
            rowGroups[cell.row] = {};
        }
        // Format the cell value for copying
        const copyValue = cleanCellValueForCopy(cell.value);
        rowGroups[cell.row][cell.col] = copyValue || '';
    });

    // Create header row
    const headerRow = headers.join('\t');

    // Create data rows
    const rows = Object.keys(rowGroups).sort((a, b) => Number(a) - Number(b));
    const dataRows = rows.map(rowIndex => {
        const row = rowGroups[rowIndex];
        return uniqueCols.map(colIndex => String(row[colIndex] || '')).join('\t');
    });

    // Combine header and data
    const copyText = [headerRow, ...dataRows].join('\n');

    // Copy to clipboard
    navigator.clipboard.writeText(copyText).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        fallbackCopyTextToClipboard(copyText);
    });
}

function copySelectedCellsFormatted() {
    if (selectedCells.size === 0) return;

    // Get all selected cells with their positions
    const cellData = [];
    selectedCells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        if (currentResults && currentResults.data[row] && currentResults.data[row][col] !== undefined) {
            cellData.push({
                row,
                col,
                value: currentResults.data[row][col] || ''
            });
        }
    });

    if (cellData.length === 0) return;

    // Sort by row then by column
    cellData.sort((a, b) => a.row - b.row || a.col - b.col);

    // Format cells for copying - use formatted JSON for objects, regular text for others
    const formattedCells = cellData.map(cell => {
        let copyValue = cell.value;
        
        // Handle special __HTML__ prefixed values by extracting the text content
        if (typeof copyValue === 'string' && copyValue.startsWith('__HTML__')) {
            const htmlContent = copyValue.substring(8); // Remove __HTML__ prefix
            
            // Create a temporary element to extract text content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            copyValue = tempDiv.textContent || tempDiv.innerText || '';
        } else if (typeof copyValue === 'object' && copyValue !== null) {
            // Use formatted JSON (like in tooltip) for objects
            try {
                copyValue = JSON.stringify(copyValue, null, 2);
            } catch (error) {
                copyValue = String(copyValue);
            }
        } else {
            copyValue = String(copyValue || '');
        }
        return copyValue;
    });

    // Join with newlines for multi-cell selection, or just return single cell
    const copyText = formattedCells.join('\n\n');

    // Copy to clipboard
    navigator.clipboard.writeText(copyText).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        fallbackCopyTextToClipboard(copyText);
    });
}

function copyRightClickedCellCompressed() {
    if (!rightClickedCell || !currentResults || !currentResults.data ||
        isNaN(rightClickedCell.row) || isNaN(rightClickedCell.col) ||
        rightClickedCell.row < 0 || rightClickedCell.col < 0 ||
        rightClickedCell.row >= currentResults.data.length ||
        rightClickedCell.col >= (currentResults.data[rightClickedCell.row] || []).length) {
        return;
    }

    const cellValue = currentResults.data[rightClickedCell.row][rightClickedCell.col];
    let copyValue = cellValue;

    // Handle special __HTML__ prefixed resolved identity values  
    if (typeof copyValue === 'string' && copyValue.startsWith('__HTML__') && copyValue.includes('resolved-identity')) {
        // Extract JSON data from data-tooltip attribute
        const tooltipMatch = copyValue.match(/data-tooltip="([^"]+)"/);
        if (tooltipMatch) {
            try {
                // Decode the tooltip content and parse as JSON
                const decodedTooltip = tooltipMatch[1].replace(/&quot;/g, '"');
                const jsonData = JSON.parse(decodedTooltip);
                copyValue = JSON.stringify(jsonData); // Compressed (no formatting)
            } catch (error) {
                // Fallback to text content if JSON parsing fails
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = copyValue.substring(8);
                copyValue = tempDiv.textContent || tempDiv.innerText || '';
            }
        } else {
            // Fallback to text content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = copyValue.substring(8);
            copyValue = tempDiv.textContent || tempDiv.innerText || '';
        }
    } else if (typeof copyValue === 'object' && copyValue !== null) {
        // Compressed JSON (no formatting)
        try {
            copyValue = JSON.stringify(copyValue);
        } catch (error) {
            copyValue = String(copyValue);
        }
    } else {
        copyValue = String(copyValue || '');
    }

    // Copy to clipboard
    navigator.clipboard.writeText(copyValue).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        fallbackCopyTextToClipboard(copyValue);
    });
}

// Helper function to clean cell values for copying (handles __HTML__ prefix)
function cleanCellValueForCopy(cellValue) {
    let copyValue = cellValue;

    // Handle special __HTML__ prefixed values by extracting the text content
    if (typeof copyValue === 'string' && copyValue.startsWith('__HTML__')) {
        const htmlContent = copyValue.substring(8); // Remove __HTML__ prefix
        
        // Create a temporary element to extract text content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        copyValue = tempDiv.textContent || tempDiv.innerText || '';
    } else if (typeof copyValue === 'object' && copyValue !== null) {
        // Format the cell value for copying
        copyValue = JSON.stringify(copyValue);
    } else {
        copyValue = String(copyValue || '');
    }

    return copyValue;
}

function copyRightClickedCell() {
    if (!rightClickedCell || !currentResults || !currentResults.data ||
        isNaN(rightClickedCell.row) || isNaN(rightClickedCell.col) ||
        rightClickedCell.row < 0 || rightClickedCell.col < 0 ||
        rightClickedCell.row >= currentResults.data.length ||
        rightClickedCell.col >= (currentResults.data[rightClickedCell.row] || []).length) {
        return;
    }

    const cellValue = currentResults.data[rightClickedCell.row][rightClickedCell.col];
    const copyValue = cleanCellValueForCopy(cellValue);

    // Copy to clipboard
    navigator.clipboard.writeText(copyValue).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        fallbackCopyTextToClipboard(copyValue);
    });
}

function copyRightClickedCellFormatted() {
    if (!rightClickedCell || !currentResults || !currentResults.data ||
        isNaN(rightClickedCell.row) || isNaN(rightClickedCell.col) ||
        rightClickedCell.row < 0 || rightClickedCell.col < 0 ||
        rightClickedCell.row >= currentResults.data.length ||
        rightClickedCell.col >= (currentResults.data[rightClickedCell.row] || []).length) {
        return;
    }

    const cellValue = currentResults.data[rightClickedCell.row][rightClickedCell.col];
    let copyValue = cellValue;

    // Handle special __HTML__ prefixed resolved identity values
    if (typeof copyValue === 'string' && copyValue.startsWith('__HTML__') && copyValue.includes('resolved-identity')) {
        // Extract JSON data from data-tooltip attribute
        const tooltipMatch = copyValue.match(/data-tooltip="([^"]+)"/);
        if (tooltipMatch) {
            try {
                // Decode the tooltip content and parse as JSON
                const decodedTooltip = tooltipMatch[1].replace(/&quot;/g, '"');
                const jsonData = JSON.parse(decodedTooltip);
                copyValue = JSON.stringify(jsonData, null, 2);
            } catch (error) {
                // Fallback to text content if JSON parsing fails
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = copyValue.substring(8);
                copyValue = tempDiv.textContent || tempDiv.innerText || '';
            }
        } else {
            // Fallback to text content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = copyValue.substring(8);
            copyValue = tempDiv.textContent || tempDiv.innerText || '';
        }
    } else if (typeof copyValue === 'string' && copyValue.startsWith('__HTML__')) {
        const htmlContent = copyValue.substring(8); // Remove __HTML__ prefix
        
        // Create a temporary element to extract text content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        copyValue = tempDiv.textContent || tempDiv.innerText || '';
    } else if (typeof copyValue === 'object' && copyValue !== null) {
        // Format the cell value for copying
        // Use formatted JSON (like in tooltip) for objects
        try {
            copyValue = JSON.stringify(copyValue, null, 2);
        } catch (error) {
            copyValue = String(copyValue);
        }
    } else {
        copyValue = String(copyValue || '');
    }

    // Copy to clipboard
    navigator.clipboard.writeText(copyValue).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        fallbackCopyTextToClipboard(copyValue);
    });
}

function updateTableAfterSort(sortedData) {
    // Store original selected rows data before updating currentResults
    const originalSelectedRowsData = selectedDetailRowIndices.map(index => {
        return currentResults.data[index];
    });

    // Update currentResults with sorted data
    currentResults = { ...currentResults, data: sortedData };

    // Find new indices for selected rows in the sorted data
    if (selectedDetailRowIndices.length > 0) {
        const newSelectedIndices = [];

        originalSelectedRowsData.forEach(originalRowData => {
            if (originalRowData) {
                // Find this row in the sorted data
                const newIndex = sortedData.findIndex(row => {
                    // Simple string comparison of entire row
                    return JSON.stringify(row) === JSON.stringify(originalRowData);
                });

                if (newIndex !== -1) {
                    newSelectedIndices.push(newIndex);
                }
            }
        });

        // Update the selected row indices
        selectedDetailRowIndices = newSelectedIndices;
    }

    // Rebuild just the table body without affecting details pane
    const tableContainer = document.getElementById('tableContainer');
    const table = tableContainer.querySelector('.results-table');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    // Update header sort indicators
    const headers = table.querySelectorAll('th');
    headers.forEach((th, index) => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (sortState.column === index - 1) { // -1 for details button column
            th.classList.add(sortState.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });

    // Rebuild table body
    let bodyHtml = '';
    sortedData.forEach((row, rowIndex) => {
        bodyHtml += '<tr>';

        // Add details button cell  
        const isSelected = selectedDetailRowIndices.includes(rowIndex);
        const circleIcon = isSelected ?
            '<circle cx="8" cy="8" r="5" fill="currentColor"/>' :
            '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="2"/>';

        bodyHtml += '<td class="detail-button-cell">' +
            '<button class="detail-button' + (isSelected ? ' active' : '') + '" onclick="showRowDetails(' + rowIndex + ')" title="View row details">' +
            '<svg viewBox="0 0 16 16">' +
            circleIcon +
            '</svg>' +
            '</button>' +
            '</td>';

        row.forEach((cell, cellIndex) => {
            const { displayValue, tooltipValue } = formatCellValue(cell);
            // Properly escape tooltip value for HTML attribute
            const escapedTooltip = tooltipValue
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            bodyHtml += '<td data-tooltip="' + escapedTooltip + '" ' +
                'onclick="selectCell(this, ' + rowIndex + ', ' + cellIndex + ')" ' +
                'onmousedown="startCellDrag(event, this, ' + rowIndex + ', ' + cellIndex + ')"' +
                'onmouseenter="handleCellDragEnter(event, this, ' + rowIndex + ', ' + cellIndex + ')" ' +
                'onmouseleave="hideCustomTooltipDelayed()" ' +
                'data-row="' + rowIndex + '" ' +
                'data-col="' + cellIndex + '">' + displayValue + '</td>';
        });
        bodyHtml += '</tr>';
    });

    tbody.innerHTML = bodyHtml;

    // Update detail button states after table regeneration
    setTimeout(() => {
        updateDetailButtonStates();
    }, 0);

    // Add context menu event listener to the table
    const tableElement = tableContainer.querySelector('.results-table');
    if (tableElement) {
        // Remove existing listener to avoid duplicates
        tableElement.removeEventListener('contextmenu', handleTableContextMenu);
        tableElement.addEventListener('contextmenu', handleTableContextMenu);
    }

    // Update details panel if it's open
    updateDetailsAfterSort();
}

function sortTable(columnIndex) {
    if (!currentResults || !currentResults.data) return;

    let direction = 'asc';
    if (sortState.column === columnIndex && sortState.direction === 'asc') {
        direction = 'desc';
    }

    sortState = { column: columnIndex, direction };

    const sortedData = [...currentResults.data].sort((a, b) => {
        const aVal = a[columnIndex];
        const bVal = b[columnIndex];

        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return direction === 'asc' ? -1 : 1;
        if (bVal == null) return direction === 'asc' ? 1 : -1;

        const aNum = Number(aVal);
        const bNum = Number(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
            return direction === 'asc' ? aNum - bNum : bNum - aNum;
        }

        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();

        if (direction === 'asc') {
            return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
        } else {
            return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
        }
    });

    updateTableAfterSort(sortedData);
}

function exportToCsv() {
    if (currentResults) {
        vscode.postMessage({
            type: 'exportCsv',
            payload: {
                data: currentResults,
                filename: 'barge-results-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv'
            }
        });
    }
}

function selectRange(startRow, startCol, endRow, endCol) {
    clearSelection();

    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const cellElement = document.querySelector('td[data-row="' + r + '"][data-col="' + c + '"]');
            if (cellElement) {
                const cellKey = r + '-' + c;
                selectedCells.add(cellKey);
                cellElement.classList.add('selected');
            }
        }
    }
}

function clearSelection() {
    selectedCells.clear();
    document.querySelectorAll('.results-table td.selected').forEach(cell => {
        cell.classList.remove('selected');
    });
}

// Drag selection functionality
function startCellDrag(event, cellElement, row, col) {
    // Don't start drag if it's a right-click (we want context menu)
    if (event.button === 2) {
        return;
    }

    // Prevent text selection during drag
    event.preventDefault();
    document.body.style.userSelect = 'none';

    isDragging = true;
    dragStartCell = { row, col, element: cellElement };
    dragCurrentCell = { row, col, element: cellElement };

    // Clear previous selection if not using Ctrl/Cmd
    if (!event.ctrlKey && !event.metaKey) {
        clearSelection();
    }

    // Select the starting cell
    toggleCellSelection(cellElement, row, col);
    selectionStart = { row, col };

    // Add document-level mouse up listener to end drag
    document.addEventListener('mouseup', endCellDrag, { once: true });

    // Prevent the default click handler from firing
    event.stopPropagation();
}

function handleCellDragEnter(event, cellElement, row, col) {
    // Only handle tooltip if we're not dragging
    if (!isDragging) {
        showCustomTooltip(event, cellElement);
        return;
    }

    // Handle drag selection
    if (isDragging && dragStartCell) {
        dragCurrentCell = { row, col, element: cellElement };

        // Clear current selection (but keep Ctrl/Cmd behavior)
        if (!event.ctrlKey && !event.metaKey) {
            clearSelection();
        }

        // Select range from start to current cell
        selectRange(dragStartCell.row, dragStartCell.col, row, col);
    }
}

function endCellDrag(event) {
    if (isDragging) {
        isDragging = false;
        dragStartCell = null;
        dragCurrentCell = null;

        // Re-enable text selection
        document.body.style.userSelect = '';
    }
}

// Add keyboard support for cell selection
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        // Close details panel if open, otherwise clear selection
        if (selectedDetailRowIndices.length > 0) {
            closeDetails();
        } else {
            clearSelection();
            hideContextMenu(); // Also hide context menu on Escape
        }
    } else if (selectedDetailRowIndices.length === 1 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        // Navigate details panel with arrow keys when exactly one row is selected
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        navigateDetails(direction);
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        // Ctrl/Cmd+A to select all cells
        event.preventDefault();
        selectAllCells();
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        // Ctrl/Cmd+C to copy selected cells
        event.preventDefault();
        copySelectedCells();
    }
});

function copySelectedCells() {
    if (selectedCells.size === 0) return;

    // Get all selected cells with their positions
    const cellData = [];
    selectedCells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cellElement = document.querySelector('td[data-row="' + row + '"][data-col="' + col + '"]');
        if (cellElement && currentResults && currentResults.data[row] && currentResults.data[row][col] !== undefined) {
            cellData.push({
                row,
                col,
                value: currentResults.data[row][col] || ''
            });
        }
    });

    if (cellData.length === 0) return;

    // Sort by row then by column
    cellData.sort((a, b) => a.row - b.row || a.col - b.col);

    // Group by rows and create tab-separated text
    const rowGroups = {};
    cellData.forEach(cell => {
        if (!rowGroups[cell.row]) {
            rowGroups[cell.row] = {};
        }
        // Format the cell value for copying (use raw value for objects, formatted for display)
        const copyValue = cleanCellValueForCopy(cell.value);
        rowGroups[cell.row][cell.col] = copyValue || '';
    });

    // Convert to tab-separated format
    const rows = Object.keys(rowGroups).sort((a, b) => Number(a) - Number(b));
    const copyText = rows.map(rowIndex => {
        const row = rowGroups[rowIndex];
        const cols = Object.keys(row).sort((a, b) => Number(a) - Number(b));

        // If it's a single row selection, just join the values with tabs
        if (rows.length === 1) {
            return cols.map(colIndex => String(row[colIndex] || '')).join('\t');
        }

        // For multiple rows, we need to handle gaps in column selection
        const minCol = Math.min(...cols.map(Number));
        const maxCol = Math.max(...cols.map(Number));
        const rowData = [];

        for (let i = minCol; i <= maxCol; i++) {
            rowData.push(String(row[i] || ''));
        }

        return rowData.join('\t');
    }).join('\n');

    // Copy to clipboard
    navigator.clipboard.writeText(copyText).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        // Fallback for older browsers
        fallbackCopyTextToClipboard(copyText);
    });
}

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        document.execCommand('copy');
        showCopyFeedback();
    } catch (err) {
        console.error('Fallback copy failed:', err);
    }

    document.body.removeChild(textArea);
}

function showCopyFeedback(type = '') {
    // Create temporary visual feedback
    const feedback = document.createElement('div');
    const cellCount = selectedCells.size;
    const typeText = type ? ' ' + type : '';
    feedback.textContent = 'Copied ' + cellCount + ' cell' + (cellCount === 1 ? '' : 's') + typeText;
    feedback.style.position = 'fixed';
    feedback.style.top = '10px';
    feedback.style.right = '10px';
    feedback.style.background = 'var(--vscode-notifications-background)';
    feedback.style.color = 'var(--vscode-notifications-foreground)';
    feedback.style.padding = '8px 12px';
    feedback.style.borderRadius = '4px';
    feedback.style.border = '1px solid var(--vscode-notifications-border)';
    feedback.style.fontSize = '0.9em';
    feedback.style.zIndex = '1000';
    feedback.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';

    document.body.appendChild(feedback);

    // Remove after 2 seconds
    setTimeout(() => {
        if (feedback.parentNode) {
            document.body.removeChild(feedback);
        }
    }, 2000);
}

function selectAllCells() {
    clearSelection();
    document.querySelectorAll('.results-table td[data-row]').forEach(cell => {
        const row = cell.getAttribute('data-row');
        const col = cell.getAttribute('data-col');
        const cellKey = row + '-' + col;
        selectedCells.add(cellKey);
        cell.classList.add('selected');
    });
}

// Column resizing functionality
let isResizing = false;
let currentResizeColumn = null;
let startX = 0;
let startWidth = 0;

function startResize(event, columnIndex) {
    event.stopPropagation();
    event.preventDefault();

    isResizing = true;
    currentResizeColumn = columnIndex;
    startX = event.clientX;

    const th = event.target.closest('th');
    startWidth = th.offsetWidth;

    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);

    // Prevent text selection during resize
    document.body.style.userSelect = 'none';
}

function handleResize(event) {
    if (!isResizing || currentResizeColumn === null) return;

    const diff = event.clientX - startX;
    const newWidth = Math.max(60, startWidth + diff); // Minimum width of 60px

    const th = document.querySelector('th[data-col-index="' + currentResizeColumn + '"]');
    if (th) {
        th.style.width = newWidth + 'px';

        // Store the width in our data
        if (currentResults && currentResults.columns[currentResizeColumn]) {
            currentResults.columns[currentResizeColumn].width = newWidth + 'px';
        }
    }
}

function stopResize() {
    isResizing = false;
    currentResizeColumn = null;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.userSelect = '';
}

// Column drag and drop functionality
let draggedColumn = null;

function handleHeaderClick(event, columnIndex) {
    // Only sort if we're not clicking on the resize handle
    if (!event.target.classList.contains('resize-handle')) {
        sortTable(columnIndex);
    }
}

function handleDragStart(event, columnIndex) {
    // Don't start drag if we're on the resize handle
    if (event.target.classList.contains('resize-handle')) {
        event.preventDefault();
        return;
    }

    draggedColumn = columnIndex;
    event.target.classList.add('dragging');

    // Set drag data
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', event.target.outerHTML);
}

function handleDragOver(event) {
    if (draggedColumn === null) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const th = event.target.closest('th');
    if (th && th !== event.target.closest('table').querySelector('.dragging')) {
        // Remove previous drag-over classes
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        th.classList.add('drag-over');
    }
}

function handleDrop(event, targetColumnIndex) {
    event.preventDefault();

    if (draggedColumn === null || draggedColumn === targetColumnIndex) {
        return;
    }

    // Reorder the columns in our data
    reorderColumn(draggedColumn, targetColumnIndex);

    // Clear drag states
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragEnd(event) {
    event.target.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedColumn = null;
}

function reorderColumn(fromIndex, toIndex) {
    if (!currentResults || !currentResults.columns || !currentResults.data) return;

    // Reorder columns metadata
    const columns = [...currentResults.columns];
    const [movedColumn] = columns.splice(fromIndex, 1);
    columns.splice(toIndex, 0, movedColumn);

    // Reorder data
    const data = currentResults.data.map(row => {
        const newRow = [...row];
        const [movedCell] = newRow.splice(fromIndex, 1);
        newRow.splice(toIndex, 0, movedCell);
        return newRow;
    });

    // Update our current results
    currentResults = {
        ...currentResults,
        columns,
        data
    };

    // Update sort state if needed
    if (sortState.column !== null) {
        if (sortState.column === fromIndex) {
            sortState.column = toIndex;
        } else if (fromIndex < toIndex && sortState.column > fromIndex && sortState.column <= toIndex) {
            sortState.column--;
        } else if (fromIndex > toIndex && sortState.column >= toIndex && sortState.column < fromIndex) {
            sortState.column++;
        }
    }

    // Clear selection since column indices have changed
    clearSelection();

    // Re-render the table but preserve the details pane
    displayResults(currentResults, true);
    
    // Update details panel content to reflect new column order
    updateDetailsAfterSort();
}

function displayError(error, errorDetails, rawError) {
    const tableContainer = document.getElementById('tableContainer');
    const resultsInfo = document.getElementById('resultsInfo');
    const exportBtn = document.getElementById('exportBtn');

    let errorHtml = '<div class="error">';
    errorHtml += '<div class="error-title">Query Execution Failed</div>';

    // Main error message (usually the support/correlation info)
    if (error && error.trim()) {
        errorHtml += '<div class="error-message">' + escapeHtml(error) + '</div>';
    }
    
    // Content container that will be toggled
    errorHtml += '<div id="errorContentContainer">';
    
    // Details section - render each as separate compact boxes
    if (errorDetails && errorDetails.trim()) {
        const detailSections = errorDetails.split('\n---\n'); // Split by our separator
        
        if (detailSections.length > 0) {
            errorHtml += '<div class="error-details-container" id="parsedErrorContent">';
            
            detailSections.forEach((section, index) => {
                if (section.trim()) {
                    errorHtml += '<div class="error-detail-box">';
                    
                    // Split lines within each section and format them nicely
                    const lines = section.trim().split('\n');
                    lines.forEach((line, lineIndex) => {
                        if (line.trim()) {
                            const [key, ...valueParts] = line.split(': ');
                            const value = valueParts.join(': ');
                            
                            if (value) {
                                errorHtml += '<div class="error-detail-item">';
                                errorHtml += '<span class="error-detail-key">' + escapeHtml(key) + ':</span> ';
                                errorHtml += '<span class="error-detail-value">' + escapeHtml(value) + '</span>';
                                errorHtml += '</div>';
                            } else {
                                // Handle lines that don't have the "key: value" format
                                errorHtml += '<div class="error-detail-item">' + escapeHtml(line) + '</div>';
                            }
                        }
                    });
                    
                    errorHtml += '</div>';
                }
            });
            
            errorHtml += '</div>';
        }
    }
    
    // Raw error content (hidden by default)
    if (rawError) {
        const rawErrorJson = JSON.stringify(rawError, null, 2);
        errorHtml += '<div class="error-raw-content" id="rawErrorContent" style="display: none;">';
        errorHtml += escapeHtml(rawErrorJson);
        errorHtml += '</div>';
    }
    
    errorHtml += '</div>'; // Close errorContentContainer
    
    // Add toggle control if we have raw error data
    const hasRawError = rawError && typeof rawError === 'object' && rawError !== null && Object.keys(rawError).length > 0;
    
    if (hasRawError) {
        errorHtml += '<div class="error-toggle-container">';
        errorHtml += '<div class="error-toggle-control">';
        errorHtml += '<span class="error-toggle-label">Parsed Error</span>';
        errorHtml += '<label class="error-toggle-switch">';
        errorHtml += '<input type="checkbox" id="errorToggleInput" onchange="toggleErrorDisplay()">';
        errorHtml += '<span class="error-toggle-slider"></span>';
        errorHtml += '</label>';
        errorHtml += '<span class="error-toggle-label">Raw Error</span>';
        errorHtml += '</div>';
        errorHtml += '</div>';
    }
    
    errorHtml += '</div>';
    
    if (tableContainer) {
        tableContainer.innerHTML = errorHtml;
    }
    if (resultsInfo) {
        resultsInfo.textContent = 'Query execution failed.';
    }
    if (exportBtn) {
        exportBtn.style.display = 'none';
    }
}

// Error display toggle functionality
function toggleErrorDisplay() {
    const toggleInput = document.getElementById('errorToggleInput');
    const parsedContent = document.getElementById('parsedErrorContent');
    const rawContent = document.getElementById('rawErrorContent');
    
    if (!toggleInput) {
        return;
    }
    
    const isShowingRaw = toggleInput.checked;
    
    if (isShowingRaw) {
        // Switch to raw view
        if (rawContent) {
            rawContent.style.display = 'block';
        }
        if (parsedContent) {
            parsedContent.style.display = 'none';
        }
    } else {
        // Switch to parsed view
        if (rawContent) {
            rawContent.style.display = 'none';
        }
        if (parsedContent) {
            parsedContent.style.display = 'block';
        }
    }
}

// Details panel functionality
let currentDetailRowIndex = -1;
let selectedDetailRowIndices = []; // Array to track multiple selected rows
let currentDetailRowData = null;

function updateDetailButtonStates() {
    const buttons = document.querySelectorAll('.detail-button');
    buttons.forEach((button, index) => {
        const isActive = selectedDetailRowIndices.includes(index);
        const svg = button.querySelector('svg');
        if (svg) {
            const circle = svg.querySelector('circle');
            if (circle) {
                if (isActive) {
                    circle.setAttribute('fill', 'currentColor');
                    circle.removeAttribute('stroke');
                    circle.removeAttribute('stroke-width');
                    circle.setAttribute('r', '5');
                    button.classList.add('active');
                } else {
                    circle.setAttribute('fill', 'none');
                    circle.setAttribute('stroke', 'currentColor');
                    circle.setAttribute('stroke-width', '2');
                    circle.setAttribute('r', '5');
                    button.classList.remove('active');
                }
            }
        }
    });

    // Update magnifying glass header state
    const headerMagnifyingGlass = document.querySelector('.select-all-header svg circle');
    if (headerMagnifyingGlass) {
        const isComparisonActive = selectedDetailRowIndices.length > 1;
        if (isComparisonActive) {
            // Add blue fill while keeping the grey outline
            headerMagnifyingGlass.setAttribute('fill', 'var(--vscode-focusBorder)');
            headerMagnifyingGlass.setAttribute('stroke', 'currentColor');
            headerMagnifyingGlass.setAttribute('stroke-width', '1.5');
        } else {
            // Reset to outline only
            headerMagnifyingGlass.setAttribute('fill', 'none');
            headerMagnifyingGlass.setAttribute('stroke', 'currentColor');
            headerMagnifyingGlass.setAttribute('stroke-width', '1.5');
        }
    }
}

function selectEntireRow(rowIndex) {
    if (!currentResults || !currentResults.columns || rowIndex < 0) {
        return;
    }

    // Don't clear selection here anymore - it's handled by the caller

    // Select all cells in the row (excluding the details button column which is at index -1)
    for (let colIndex = 0; colIndex < currentResults.columns.length; colIndex++) {
        const cellElement = document.querySelector('td[data-row="' + rowIndex + '"][data-col="' + colIndex + '"]');
        if (cellElement) {
            const cellKey = rowIndex + '-' + colIndex;
            selectedCells.add(cellKey);
            cellElement.classList.add('selected');
        }
    }
}

function toggleSelectAllRows() {
    if (!currentResults || !currentResults.data) {
        return;
    }

    // Check if all rows are currently selected
    const allSelected = currentResults.data.length > 0 &&
        selectedDetailRowIndices.length === currentResults.data.length &&
        selectedDetailRowIndices.every((index, i) => index === i);

    if (allSelected) {
        // Deselect all rows and close details pane
        selectedDetailRowIndices = [];
        // Clear all cell selections
        clearSelection();
        updateDetailButtonStates();
        updateDetailsNavigation(); // Update arrow navigation buttons
        closeDetails();
    } else {
        // Select all rows (or remaining rows)
        selectedDetailRowIndices = [];
        for (let i = 0; i < currentResults.data.length; i++) {
            selectedDetailRowIndices.push(i);
        }

        // Update the detail buttons visual state
        updateDetailButtonStates();
        updateDetailsNavigation(); // Update arrow navigation buttons

        // Select all cells in all selected rows (clear previous selection first)
        clearSelection();
        selectedDetailRowIndices.forEach(idx => selectEntireRow(idx));

        // Show comparison view for all rows
        if (selectedDetailRowIndices.length > 1) {
            // Open details pane properly with correct sizing
            const detailsSection = document.getElementById('detailsSection');
            const resizeHandle = document.getElementById('resizeHandle');
            const tableSection = document.getElementById('tableSection');

            // Detect and set proper layout
            detectAndSetLayout();
            
            // Check if details pane is already open to preserve user's resize
            const isDetailsAlreadyOpen = detailsSection && detailsSection.style.display === 'flex';

            // Show the details section and resize handle
            if (detailsSection) detailsSection.style.display = 'flex';
            if (resizeHandle) resizeHandle.style.display = 'block';

            // Only set initial flex values if details pane wasn't already open
            if (!isDetailsAlreadyOpen && tableSection && detailsSection) {
                tableSection.style.flex = '2 1 0';
                detailsSection.style.flex = '1 1 0';
            }

            // Only set initial resize handle position if details pane wasn't already open
            if (!isDetailsAlreadyOpen) {
                setTimeout(() => {
                    const resizeHandle = document.getElementById('resizeHandle');
                    if (resizeHandle) {
                        if (currentLayout === 'horizontal') {
                            resizeHandle.style.left = '66.666%';
                            resizeHandle.style.top = '2.5%'; // Account for 95% height with 2.5% margin
                        } else {
                            resizeHandle.style.top = 'calc(66.666% - 3px)';
                            resizeHandle.style.left = '2.5%'; // Account for 95% width with 2.5% margin
                        }
                        initializeResizing();
                    }
                }, 0);
            }

            const detailsContent = document.getElementById('detailsContent');
            if (detailsContent) {
                detailsContent.innerHTML = generateComparisonView(selectedDetailRowIndices);
                detailsContent.classList.add('comparison-view');
                initializeComparisonColumnResizing();
                // Initialize custom context menu for details content
                initializeDetailsContextMenu();
            }

            // Update the details panel title
            const detailsTitle = document.querySelector('.details-title');
            if (detailsTitle) {
                detailsTitle.textContent = 'Comparing ' + selectedDetailRowIndices.length + ' rows';
            }
        } else if (selectedDetailRowIndices.length === 1) {
            // Show single row details
            showRowDetails(selectedDetailRowIndices[0]);
        }
    }
}

function showRowDetails(rowIndex) {
    if (!currentResults || !currentResults.data || rowIndex < 0 || rowIndex >= currentResults.data.length) {
        return;
    }

    // Toggle selection for multiple row comparison
    const existingIndex = selectedDetailRowIndices.indexOf(rowIndex);
    if (existingIndex >= 0) {
        // Remove from selection
        selectedDetailRowIndices.splice(existingIndex, 1);
        if (selectedDetailRowIndices.length === 0) {
            closeDetails();
            return;
        }
    } else {
        // Add to selection
        selectedDetailRowIndices.push(rowIndex);
    }

    // For backward compatibility, keep currentDetailRowIndex as the first selected
    currentDetailRowIndex = selectedDetailRowIndices[0] || -1;
    currentDetailRowData = selectedDetailRowIndices.length > 0 ? currentResults.data[selectedDetailRowIndices[0]] : null;

    // Update button states to show active state
    updateDetailButtonStates();
    updateDetailsNavigation(); // Update arrow navigation buttons

    // Select all selected rows (clear previous selection first)
    clearSelection();
    selectedDetailRowIndices.forEach(idx => selectEntireRow(idx));

    const contentWrapper = document.getElementById('contentWrapper');
    const detailsSection = document.getElementById('detailsSection');
    const tableSection = document.getElementById('tableSection');
    const resizeHandle = document.getElementById('resizeHandle');
    const detailsContent = document.getElementById('detailsContent');
    const detailsTitle = document.querySelector('.details-title');

    // Detect and set layout
    detectAndSetLayout();
    
    // Check if details pane is already open to preserve user's resize
    const isDetailsAlreadyOpen = detailsSection && detailsSection.style.display === 'flex';

    // Show the details section and resize handle
    detailsSection.style.display = 'flex';
    resizeHandle.style.display = 'block';

    // Only set initial flex values if details pane wasn't already open
    if (!isDetailsAlreadyOpen && tableSection && detailsSection) {
        tableSection.style.flex = '2 1 0';
        detailsSection.style.flex = '1 1 0';
    }

    // Only set initial resize handle position if details pane wasn't already open
    if (!isDetailsAlreadyOpen) {
        setTimeout(() => {
            const resizeHandle = document.getElementById('resizeHandle');
            if (resizeHandle) {
                if (currentLayout === 'horizontal') {
                    resizeHandle.style.left = '66.666%';
                    resizeHandle.style.top = '2.5%'; // Account for 95% height with 2.5% margin
                } else {
                    resizeHandle.style.top = 'calc(66.666% - 3px)';
                    resizeHandle.style.left = '2.5%'; // Account for 95% width with 2.5% margin
                }
            }
        }, 0);
    }

    // Initialize resizing if not already done
    initializeResizing();

    // Update title to show selected rows
    if (selectedDetailRowIndices.length === 1) {
        const rowNumber = selectedDetailRowIndices[0] + 1;
        const totalRows = currentResults.data.length;
        detailsTitle.textContent = 'Row ' + rowNumber + ' of ' + totalRows;
    } else {
        detailsTitle.textContent = 'Comparing ' + selectedDetailRowIndices.length + ' rows';
    }

    // Update navigation buttons
    updateDetailsNavigation();

    // Generate and display the comparison or single row details
    if (selectedDetailRowIndices.length === 1) {
        const rowData = generateRowObject(selectedDetailRowIndices[0]);
        const jsonHtml = formatAsJsonViewer(rowData);
        detailsContent.innerHTML = jsonHtml;
        // Remove comparison view class for single row
        detailsContent.classList.remove('comparison-view');
        // Initialize custom context menu for details content
        initializeDetailsContextMenu();
    } else {
        const comparisonHtml = generateComparisonView(selectedDetailRowIndices);
        detailsContent.innerHTML = comparisonHtml;
        // Add comparison view class for reduced padding
        detailsContent.classList.add('comparison-view');
        // Initialize column resizing for comparison table
        initializeComparisonColumnResizing();
        // Initialize custom context menu for details content
        initializeDetailsContextMenu();
    }
}

function closeDetails() {
    const detailsSection = document.getElementById('detailsSection');
    const resizeHandle = document.getElementById('resizeHandle');
    const tableSection = document.getElementById('tableSection');
    const detailsContent = document.getElementById('detailsContent');

    detailsSection.style.display = 'none';
    resizeHandle.style.display = 'none';

    // Reset flex values
    if (tableSection) tableSection.style.flex = '';
    if (detailsSection) detailsSection.style.flex = '';

    // Remove comparison view class
    if (detailsContent) {
        detailsContent.classList.remove('comparison-view');
    }

    currentDetailRowIndex = -1;
    selectedDetailRowIndices = []; // Clear multiple selection
    currentDetailRowData = null;

    // Update button states to remove active state
    updateDetailButtonStates();
    updateDetailsNavigation(); // Update arrow navigation buttons
}

function updateDetailsAfterSort() {
    // If details panel is open with selected rows, update the content and navigation
    if (selectedDetailRowIndices.length > 0 && currentResults && currentResults.data) {
        // Update current detail row index to the first selected row
        if (selectedDetailRowIndices.length > 0) {
            currentDetailRowIndex = selectedDetailRowIndices[0];
            currentDetailRowData = currentResults.data[currentDetailRowIndex];
        }

        // Clear selection and re-select all the rows at their new positions
        clearSelection();
        selectedDetailRowIndices.forEach(index => selectEntireRow(index));

        // Update the details panel content
        if (selectedDetailRowIndices.length === 1) {
            // Single row - show details
            const detailsTitle = document.querySelector('.details-title');
            if (detailsTitle) {
                const rowNumber = selectedDetailRowIndices[0] + 1;
                const totalRows = currentResults.data.length;
                detailsTitle.textContent = 'Row ' + rowNumber + ' of ' + totalRows;
            }

            const detailsContent = document.getElementById('detailsContent');
            if (detailsContent) {
                const rowData = generateRowObject(selectedDetailRowIndices[0]);
                const jsonHtml = formatAsJsonViewer(rowData);
                detailsContent.innerHTML = jsonHtml;
                detailsContent.classList.remove('comparison-view');
                // Initialize custom context menu for details content
                initializeDetailsContextMenu();
            }
        } else if (selectedDetailRowIndices.length > 1) {
            // Multiple rows - show comparison
            const detailsTitle = document.querySelector('.details-title');
            if (detailsTitle) {
                detailsTitle.textContent = 'Comparing ' + selectedDetailRowIndices.length + ' rows';
            }

            const detailsContent = document.getElementById('detailsContent');
            if (detailsContent) {
                const comparisonHtml = generateComparisonView(selectedDetailRowIndices);
                detailsContent.innerHTML = comparisonHtml;
                detailsContent.classList.add('comparison-view');
                initializeComparisonColumnResizing();
                // Initialize custom context menu for details content
                initializeDetailsContextMenu();
            }
        }

        // Update navigation buttons
        updateDetailsNavigation();
    }
}

function navigateDetails(direction) {
    if (!currentResults || !currentResults.data || selectedDetailRowIndices.length !== 1) {
        return; // Only allow navigation for single selection
    }

    const currentIndex = selectedDetailRowIndices[0];
    const newIndex = currentIndex + direction;

    if (newIndex >= 0 && newIndex < currentResults.data.length) {
        // Update selection
        selectedDetailRowIndices = [newIndex];
        currentDetailRowIndex = newIndex;
        currentDetailRowData = currentResults.data[newIndex];

        // Update UI - clear previous selection and select new row
        updateDetailButtonStates();

        // Clear all cell selections first, then select the new row
        clearSelection();
        selectEntireRow(newIndex);

        // Update content
        const detailsTitle = document.querySelector('.details-title');
        const detailsContent = document.getElementById('detailsContent');

        const rowNumber = newIndex + 1;
        const totalRows = currentResults.data.length;
        detailsTitle.textContent = 'Row ' + rowNumber + ' of ' + totalRows;

        const rowData = generateRowObject(newIndex);
        const jsonHtml = formatAsJsonViewer(rowData);
        detailsContent.innerHTML = jsonHtml;
        // Initialize custom context menu for details content
        initializeDetailsContextMenu();

        updateDetailsNavigation();
    }
}

function updateDetailsNavigation() {
    const prevBtn = document.getElementById('detailsPrevBtn');
    const nextBtn = document.getElementById('detailsNextBtn');

    if (!currentResults || !currentResults.data || selectedDetailRowIndices.length !== 1) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    const currentIndex = selectedDetailRowIndices[0];
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= currentResults.data.length - 1;
}

function generateRowObject(rowIndex) {
    if (!currentResults || !currentResults.columns || !currentResults.data ||
        rowIndex < 0 || rowIndex >= currentResults.data.length) {
        return {};
    }

    const row = currentResults.data[rowIndex];
    const rowObject = {};

    currentResults.columns.forEach((column, colIndex) => {
        if (colIndex < row.length) {
            rowObject[column.name] = row[colIndex];
        }
    });

    return rowObject;
}

function generateComparisonView(rowIndices) {
    if (!currentResults || !currentResults.data || rowIndices.length === 0) {
        return '<div class="comparison-viewer">No data available</div>';
    }

    // Get all unique property names across selected rows
    const allProperties = new Set();
    const rowObjects = rowIndices.map(idx => generateRowObject(idx));

    rowObjects.forEach(row => {
        Object.keys(row).forEach(key => allProperties.add(key));
    });

    // Use table column order instead of alphabetical sorting
    // This maintains consistency with the main table and preserves KQL project order
    const orderedProperties = [];
    
    // First, add properties in the order they appear in the table columns
    if (currentResults && currentResults.columns) {
        currentResults.columns.forEach(col => {
            if (allProperties.has(col.name)) {
                orderedProperties.push(col.name);
            }
        });
    }
    
    // Then add any remaining properties that aren't in the table columns (edge case)
    Array.from(allProperties).forEach(property => {
        if (!orderedProperties.includes(property)) {
            orderedProperties.push(property);
        }
    });

    let html = '<div class="comparison-viewer">';
    html += '<table class="comparison-table">';
    html += '<thead><tr>';
    html += '<th class="property-name-header">Property<div class="column-resizer"></div></th>';

    // Add column headers for each selected row
    rowIndices.forEach((rowIdx, colIdx) => {
        const isLast = colIdx === rowIndices.length - 1;
        html += '<th class="row-header">Row ' + (rowIdx + 1);
        if (!isLast) {
            html += '<div class="column-resizer"></div>';
        }
        html += '</th>';
    });
    html += '</tr></thead><tbody>';

    // Create a row for each property
    orderedProperties.forEach(property => {
        html += '<tr class="property-row">';

        // Get values for this property across all selected rows
        const values = rowObjects.map(row => row[property]);
        const uniqueValues = [...new Set(values.map(v => JSON.stringify(v)))];
        const allMatch = uniqueValues.length === 1;

        // Add property name with match indicator
        const tooltipText = allMatch ? "Values match" : "Values differ";
        html += '<td class="property-name-with-indicator" title="' + tooltipText + '">';
        html += '<span class="property-name-text">' + escapeHtml(property) + '</span>';
        html += '<span class="match-indicator-inline">';
        if (allMatch) {
            html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
            html += '<polyline points="20,6 9,17 4,12"></polyline>';
            html += '</svg>';
        } else {
            html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
            html += '<line x1="18" y1="6" x2="6" y2="18"></line>';
            html += '<line x1="6" y1="6" x2="18" y2="18"></line>';
            html += '</svg>';
        }
        html += '</span>';
        html += '</td>';

        // Add value columns
        values.forEach((value, valueIndex) => {
            // Create unique identifiers for comparison table cells
            const comparisonRowIndex = Array.from(allProperties).sort().indexOf(property);
            const comparisonColIndex = valueIndex;
            
            // Add tooltip value for the cell
            let tooltipValue = '';
            if (value === null || value === undefined) {
                tooltipValue = 'null';
            } else if (typeof value === 'object') {
                tooltipValue = JSON.stringify(value, null, 2);
            } else {
                tooltipValue = String(value);
            }
            
            html += '<td class="property-value comparison-cell" ' +
                'data-tooltip="' + escapeHtml(tooltipValue).replace(/"/g, '&quot;') + '" ' +
                'data-comparison-row="' + comparisonRowIndex + '" ' +
                'data-comparison-col="' + comparisonColIndex + '" ' +
                'data-original-row="' + rowIndices[valueIndex] + '" ' +
                'data-property="' + escapeHtml(property) + '">';
            
            if (value === null || value === undefined) {
                html += '<span class="null-value">null</span>';
            } else if (typeof value === 'object') {
                html += '<pre class="object-value">' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre>';
            } else {
                html += '<span class="scalar-value">' + escapeHtml(String(value)) + '</span>';
            }
            html += '</td>';
        });

        html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

function updateComparisonViewAfterColumnReorder() {
    // Check if the comparison view is currently open
    const detailsContent = document.getElementById('detailsContent');
    if (!detailsContent || !detailsContent.classList.contains('comparison-view')) {
        return; // Comparison view is not open, nothing to update
    }
    
    // Check if we have selected rows for comparison
    if (!selectedDetailRowIndices || selectedDetailRowIndices.length === 0) {
        return; // No rows selected for comparison
    }
    
    // Regenerate the comparison view with the new column order
    const comparisonHtml = generateComparisonView(selectedDetailRowIndices);
    detailsContent.innerHTML = comparisonHtml;
    
    // Re-initialize column resizing for the updated comparison table
    initializeComparisonColumnResizing();
    
    // Re-initialize context menu for the updated content
    initializeDetailsContextMenu();
}

function initializeComparisonColumnResizing() {
    const table = document.querySelector('.comparison-table');
    if (!table) return;

    const resizers = table.querySelectorAll('.column-resizer');
    let isResizing = false;
    let currentResizer = null;
    let startX = 0;
    let startWidth = 0;

    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            currentResizer = resizer;
            startX = e.clientX;

            const th = resizer.parentElement;
            startWidth = th.offsetWidth;

            // Prevent text selection during resize
            e.preventDefault();
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
        });
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing || !currentResizer) return;

        const th = currentResizer.parentElement;
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff); // Minimum width of 50px

        th.style.width = newWidth + 'px';
        th.style.minWidth = newWidth + 'px';
        th.style.maxWidth = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            currentResizer = null;
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        }
    });
}

function formatAsJsonViewer(obj) {
    if (!obj || typeof obj !== 'object') {
        return '<div class="json-viewer">No data available</div>';
    }

    let html = '<div class="json-viewer">';

    Object.keys(obj).forEach(key => {
        const value = obj[key];
        html += '<div class="json-property">';
        html += '<div class="json-key">' + escapeHtml(key) + '</div>';

        if (value === null || value === undefined) {
            html += '<div class="json-value null">null</div>';
        } else if (typeof value === 'string') {
            // Remove quotes for cleaner display, since we're in boxes now
            html += '<div class="json-value string">' + escapeHtml(value) + '</div>';
        } else if (typeof value === 'number') {
            html += '<div class="json-value number">' + value + '</div>';
        } else if (typeof value === 'boolean') {
            html += '<div class="json-value boolean">' + value + '</div>';
        } else if (typeof value === 'object') {
            try {
                const jsonString = JSON.stringify(value, null, 2);
                html += '<pre class="json-value object">' + escapeHtml(jsonString) + '</pre>';
            } catch (error) {
                html += '<div class="json-value object">' + escapeHtml(String(value)) + '</div>';
            }
        } else {
            html += '<div class="json-value">' + escapeHtml(String(value)) + '</div>';
        }

        html += '</div>';
    });

    html += '</div>';
    return html;
}

// Comparison table cell functionality (no selection tracking needed)
function handleComparisonCellContextMenu(event, cellElement) {
    // Create comparison-specific context menu
    const contextMenu = createComparisonContextMenu(cellElement);
    
    // Position and show context menu
    positionContextMenu(event, contextMenu);
    
    // Set flag that context menu is visible
    contextMenuVisible = true;
    
    // Add click outside listener to close menu
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
        document.addEventListener('keydown', handleContextMenuKeydown, { once: true });
    }, 0);
}

function createComparisonContextMenu(cellElement) {
    if (customContextMenu) {
        document.body.removeChild(customContextMenu);
    }

    customContextMenu = document.createElement('div');
    customContextMenu.className = 'custom-context-menu';

    // Prevent clicks on the menu itself from closing it
    customContextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Copy cell value option
    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item';
    copyItem.innerHTML = '<span>Copy</span>';
    copyItem.addEventListener('click', () => {
        copyComparisonCell(cellElement);
        hideContextMenu();
    });
    customContextMenu.appendChild(copyItem);

    // Copy compressed option (if cell contains JSON)
    const objectValue = cellElement.querySelector('.object-value');
    if (objectValue) {
        const copyCompressedItem = document.createElement('div');
        copyCompressedItem.className = 'context-menu-item';
        copyCompressedItem.innerHTML = '<span>Copy Compressed</span>';
        copyCompressedItem.addEventListener('click', () => {
            copyComparisonCellCompressed(cellElement);
            hideContextMenu();
        });
        customContextMenu.appendChild(copyCompressedItem);
    }

    document.body.appendChild(customContextMenu);
    return customContextMenu;
}

function copyComparisonCell(cellElement) {
    const tooltipValue = cellElement.getAttribute('data-tooltip');
    const copyText = tooltipValue || '';

    // Copy to clipboard
    navigator.clipboard.writeText(copyText).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        fallbackCopyTextToClipboard(copyText);
    });
}

function copyComparisonCellCompressed(cellElement) {
    const objectValue = cellElement.querySelector('.object-value');
    let copyText = '';
    
    if (objectValue) {
        // Try to compress JSON
        try {
            const parsed = JSON.parse(objectValue.textContent);
            copyText = JSON.stringify(parsed);
        } catch (e) {
            copyText = objectValue.textContent;
        }
    } else {
        const tooltipValue = cellElement.getAttribute('data-tooltip');
        try {
            const parsed = JSON.parse(tooltipValue);
            copyText = JSON.stringify(parsed);
        } catch (e) {
            copyText = tooltipValue || '';
        }
    }

    // Copy to clipboard
    navigator.clipboard.writeText(copyText).then(() => {
        // Copy successful - no feedback needed
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        fallbackCopyTextToClipboard(copyText);
    });
}

window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.type) {
        case 'queryStart':
            showLoadingIndicator();
            break;
        case 'queryResult':
            hideLoadingIndicator();
            
            if (message.payload.success) {
                displayResults(message.payload.data);
            } else {
                displayError(message.payload.error, message.payload.errorDetails, message.payload.rawError);
            }
            break;
        case 'guidResolved':
            console.log('Received guidResolved message:', message.payload);
            if (message.payload) {
                if (message.payload.responseTarget === 'single-cell') {
                    updateSingleResolvedCell(message.payload.cellPosition, message.payload.resolvedData, message.payload.isPartial);
                } else if (message.payload.responseTarget === 'multi-cell') {
                    updateMultipleResolvedCells(message.payload.selectedCells, message.payload.resolvedData, message.payload.isPartial);
                } else {
                    updateResolvedColumn(message.payload.columnIndex, message.payload.resolvedData, message.payload.isPartial);
                }
            }
            break;
        case 'confirmationResult':
            console.log('Received confirmation result:', message.payload);
            if (message.payload.confirmationType === 'bulkResolve' && message.payload.confirmed && window.pendingResolution) {
                console.log('User confirmed bulk resolution, proceeding...');
                const { columnIndex, columnName, resolveType } = window.pendingResolution;
                // Clear the pending resolution
                window.pendingResolution = null;
                // Continue with the resolution (call the function again but skip confirmation)
                continueResolveGuidColumn(columnIndex, columnName, resolveType);
            } else if (message.payload.confirmationType === 'bulkResolve') {
                console.log('User cancelled bulk resolution');
                window.pendingResolution = null;
            }
            break;
    }
});

// Layout and resizing functionality
let isResizingPanel = false;
let resizeInitialized = false;
let currentLayout = 'horizontal'; // 'horizontal' or 'vertical'

function detectAndSetLayout() {
    const contentWrapper = document.getElementById('contentWrapper');
    if (!contentWrapper) return;

    const rect = contentWrapper.getBoundingClientRect();
    const aspectRatio = rect.width / rect.height;

    // Use horizontal layout if width is significantly larger than height
    const newLayout = aspectRatio > 1.2 ? 'horizontal' : 'vertical';

    if (newLayout !== currentLayout) {
        currentLayout = newLayout;
        updateLayoutClasses();
    }
}

function updateLayoutClasses() {
    const contentWrapper = document.getElementById('contentWrapper');
    const resizeHandle = document.getElementById('resizeHandle');
    if (!contentWrapper || !resizeHandle) return;

    contentWrapper.classList.remove('layout-horizontal', 'layout-vertical');
    contentWrapper.classList.add('layout-' + currentLayout);

    // Reset any custom flex values when switching layouts
    const tableSection = document.getElementById('tableSection');
    const detailsSection = document.getElementById('detailsSection');
    if (tableSection) tableSection.style.flex = '2 1 0';
    if (detailsSection) detailsSection.style.flex = '1 1 0';

    // Position resize handle at 2:1 ratio
    if (currentLayout === 'horizontal') {
        resizeHandle.style.left = '66.666%';
        resizeHandle.style.top = '2.5%'; // Account for 95% height with 2.5% margin
    } else {
        resizeHandle.style.top = 'calc(66.666% - 3px)'; // Account for handle height
        resizeHandle.style.left = '2.5%'; // Account for 95% width with 2.5% margin
    }
}

function initializeResizing() {
    if (resizeInitialized) return;
    resizeInitialized = true;

    const resizeHandle = document.getElementById('resizeHandle');
    if (!resizeHandle) return;

    resizeHandle.addEventListener('mousedown', startResizing);

    // Add window resize listener for layout detection
    window.addEventListener('resize', detectAndSetLayout);
}

function startResizing(event) {
    event.preventDefault();
    isResizingPanel = true;

    const resizeHandle = document.getElementById('resizeHandle');
    if (resizeHandle) {
        resizeHandle.classList.add('dragging');
    }

    const cursor = currentLayout === 'horizontal' ? 'ew-resize' : 'ns-resize';
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleResizing);
    document.addEventListener('mouseup', stopResizing);
}

function handleResizing(event) {
    if (!isResizingPanel) return;

    const contentWrapper = document.getElementById('contentWrapper');
    const tableSection = document.getElementById('tableSection');
    const detailsSection = document.getElementById('detailsSection');
    const resizeHandle = document.getElementById('resizeHandle');

    if (!contentWrapper || !tableSection || !detailsSection || !resizeHandle) return;

    const wrapperRect = contentWrapper.getBoundingClientRect();

    if (currentLayout === 'horizontal') {
        // Horizontal layout - vertical divider
        const mouseX = event.clientX;
        const relativeX = mouseX - wrapperRect.left;
        const percentage = Math.max(20, Math.min(80, (relativeX / wrapperRect.width) * 100));

        const tablePercentage = percentage;
        const detailsPercentage = 100 - percentage;

        tableSection.style.flex = tablePercentage + ' 1 0';
        detailsSection.style.flex = detailsPercentage + ' 1 0';

        // Update resize handle position
        resizeHandle.style.left = percentage + '%';
        resizeHandle.style.top = '2.5%'; // Account for 95% height with 2.5% margin
    } else {
        // Vertical layout - horizontal divider
        const mouseY = event.clientY;
        const relativeY = mouseY - wrapperRect.top;
        const percentage = Math.max(20, Math.min(80, (relativeY / wrapperRect.height) * 100));

        const tablePercentage = percentage;
        const detailsPercentage = 100 - percentage;

        tableSection.style.flex = tablePercentage + ' 1 0';
        detailsSection.style.flex = detailsPercentage + ' 1 0';

        // Update resize handle position
        resizeHandle.style.top = 'calc(' + percentage + '% - 3px)'; // Account for handle height
        resizeHandle.style.left = '2.5%'; // Account for 95% width with 2.5% margin
    }
}

function stopResizing() {
    isResizingPanel = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    const resizeHandle = document.getElementById('resizeHandle');
    if (resizeHandle) {
        resizeHandle.classList.remove('dragging');
    }

    document.removeEventListener('mousemove', handleResizing);
    document.removeEventListener('mouseup', stopResizing);
}

// GUID Resolution functionality
function showResolveMenu(event, columnIndex, columnName) {
    event.stopPropagation();
    event.preventDefault();
    
    // Remove any existing menu
    const existingMenu = document.querySelector('.resolve-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'resolve-context-menu';
    
    const menuItem = document.createElement('div');
    menuItem.className = 'resolve-context-menu-item';
    menuItem.textContent = 'Resolve as Identities';
    menuItem.onclick = () => resolveGuidColumn(columnIndex, columnName, 'identity');
    
    menu.appendChild(menuItem);
    
    // Position menu relative to button
    const rect = event.target.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 2) + 'px';
    
    document.body.appendChild(menu);
    
    // Close menu when clicking elsewhere
    setTimeout(() => {
        document.addEventListener('click', closeResolveMenu);
    }, 0);
}

function closeResolveMenu() {
    const menu = document.querySelector('.resolve-context-menu');
    if (menu) {
        menu.remove();
    }
    document.removeEventListener('click', closeResolveMenu);
}

function resolveSingleGuid(row, col) {
    console.log('resolveSingleGuid called:', { row, col });
    
    if (!currentResults || !currentResults.data || !currentResults.data[row] || currentResults.data[row][col] === undefined) {
        console.log('Invalid cell reference');
        return;
    }
    
    const cellValue = currentResults.data[row][col];
    if (!isGuid(cellValue)) {
        console.log('Cell value is not a GUID:', cellValue);
        return;
    }
    
    // Get column info
    const columnName = currentResults.columns[col].name;
    
    // Create a new resolved column if it doesn't exist yet
    let resolvedColumnIndex = col + 1;
    const expectedResolvedColumnName = columnName + '_Resolved';
    
    // Check if resolved column already exists
    let needToCreateColumn = true;
    if (currentResults.columns[resolvedColumnIndex] && 
        currentResults.columns[resolvedColumnIndex].name === expectedResolvedColumnName) {
        needToCreateColumn = false;
    }
    
    if (needToCreateColumn) {
        // Create the resolved column but mark it as single-cell resolution
        resolvedColumnIndex = addResolvedColumnForSingleCell(col, columnName, 'identity');
        
        // Set loading animation for the target cell immediately with random timing
        const { offset, duration } = getRandomAnimationValues();
        currentResults.data[row][resolvedColumnIndex] = `__HTML__<div class="guid-loading" style="--animation-delay: ${offset}s; --animation-duration: ${duration}s;"></div>`;
        
        // Clear the loading spinner from all cells except the one we're resolving
        currentResults.data.forEach((dataRow, rowIndex) => {
            if (rowIndex !== row) {
                dataRow[resolvedColumnIndex] = ''; // Empty for non-resolved cells
            }
        });
        
        // Re-render to show the new column with only one loading cell
        displayResults(currentResults, true);
    } else {
        // Column exists, just add loading to this specific cell with random timing
        const { offset, duration } = getRandomAnimationValues();
        const loadingHtml = `__HTML__<div class="guid-loading" style="--animation-delay: ${offset}s; --animation-duration: ${duration}s;"></div>`;
        currentResults.data[row][resolvedColumnIndex] = loadingHtml;
        
        // Update only the specific cell in the DOM to avoid restarting other animations
        const table = document.querySelector('.results-table');
        if (table) {
            const targetCell = table.querySelector(`[data-row="${row}"][data-col="${resolvedColumnIndex}"]`);
            if (targetCell) {
                // Use smooth transition function to update the cell
                if (!updateCellWithFade(targetCell, loadingHtml)) {
                    // Fallback: re-render if cell update failed
                    displayResults(currentResults, true);
                }
            } else {
                // Fallback: re-render if we can't find the specific cell
                displayResults(currentResults, true);
            }
        } else {
            // Fallback: re-render if table doesn't exist
            displayResults(currentResults, true);
        }
    }
    
    // Resolve the single GUID
    vscode.postMessage({
        type: 'resolveGuids',
        payload: {
            columnIndex: resolvedColumnIndex,
            columnName: columnName,
            guids: [cellValue],
            resolveType: 'identity',
            responseTarget: 'single-cell',
            cellPosition: { row, col: resolvedColumnIndex }
        }
    });
}

function resolveMultipleGuids(selectedGuidCells, columnIndex) {
    console.log('resolveMultipleGuids called:', { selectedGuidCells, columnIndex });
    
    if (!currentResults || !currentResults.data || selectedGuidCells.length === 0) {
        console.log('Invalid parameters for multiple GUID resolution');
        return;
    }
    
    // Get column info
    const columnName = currentResults.columns[columnIndex].name;
    
    // Create a new resolved column if it doesn't exist yet
    let resolvedColumnIndex = columnIndex + 1;
    const expectedResolvedColumnName = columnName + '_Resolved';
    
    // Check if resolved column already exists
    let needToCreateColumn = true;
    if (currentResults.columns[resolvedColumnIndex] && 
        currentResults.columns[resolvedColumnIndex].name === expectedResolvedColumnName) {
        needToCreateColumn = false;
    }
    
    if (needToCreateColumn) {
        // Create the resolved column and mark it as multi-cell resolution
        resolvedColumnIndex = addResolvedColumnForSingleCell(columnIndex, columnName, 'identity');
        
        // Set loading animations only for the selected cells
        selectedGuidCells.forEach(({ row }) => {
            const { offset, duration } = getRandomAnimationValues();
            currentResults.data[row][resolvedColumnIndex] = `__HTML__<div class="guid-loading" style="--animation-delay: ${offset}s; --animation-duration: ${duration}s;"></div>`;
        });
        
        // Clear the loading spinner from all other cells
        currentResults.data.forEach((dataRow, rowIndex) => {
            const isSelected = selectedGuidCells.some(cell => cell.row === rowIndex);
            if (!isSelected) {
                dataRow[resolvedColumnIndex] = ''; // Empty for non-selected cells
            }
        });
        
        // Re-render to show the new column with loading cells for selected rows
        displayResults(currentResults, true);
    } else {
        // Column exists, add loading animations to the selected cells only
        const cellsToUpdate = [];
        selectedGuidCells.forEach(({ row }) => {
            const { offset, duration } = getRandomAnimationValues();
            const loadingHtml = `__HTML__<div class="guid-loading" style="--animation-delay: ${offset}s; --animation-duration: ${duration}s;"></div>`;
            currentResults.data[row][resolvedColumnIndex] = loadingHtml;
            cellsToUpdate.push({ row, col: resolvedColumnIndex, html: loadingHtml });
        });
        
        // Try to update only the modified cells to avoid restarting other animations
        const table = document.querySelector('.results-table');
        let needsFullRender = false;
        
        if (table && cellsToUpdate.length > 0) {
            cellsToUpdate.forEach(({ row, col, html }) => {
                const targetCell = table.querySelector(`[data-row="${row}"][data-col="${col}"]`);
                if (targetCell) {
                    if (!updateCellWithFade(targetCell, html)) {
                        needsFullRender = true;
                    }
                } else {
                    needsFullRender = true;
                }
            });
        } else if (cellsToUpdate.length > 0) {
            needsFullRender = true;
        }
        
        // Only do full re-render if selective updates failed
        if (needsFullRender) {
            displayResults(currentResults, true);
        }
    }
    
    // Extract GUIDs from selected cells
    const guids = selectedGuidCells.map(({ row }) => currentResults.data[row][columnIndex]);
    
    // Resolve the selected GUIDs
    vscode.postMessage({
        type: 'resolveGuids',
        payload: {
            columnIndex: resolvedColumnIndex,
            columnName: columnName,
            guids: guids,
            resolveType: 'identity',
            responseTarget: 'multi-cell',
            selectedCells: selectedGuidCells.map(({ row }) => ({ row, col: resolvedColumnIndex }))
        }
    });
}

function resolveGuidColumn(columnIndex, columnName, resolveType) {
    console.log('resolveGuidColumn called:', { columnIndex, columnName, resolveType });
    closeResolveMenu();
    
    if (!currentResults || !currentResults.data) {
        console.log('No current results or data');
        return;
    }
    
    // Extract unique GUIDs from column
    const columnData = currentResults.data.map(row => row[columnIndex]);
    const guids = [...new Set(columnData.filter(value => isGuid(value)))];
    
    console.log('Found GUIDs:', guids);
    console.log('Number of GUIDs found:', guids.length);
    
    if (guids.length === 0) {
        console.log('No valid GUIDs found');
        vscode.postMessage({
            type: 'showError',
            payload: 'No valid GUIDs found in this column.'
        });
        return;
    }
    
    // Check if more than 10 GUIDs to resolve, ask for confirmation
    console.log('Checking if confirmation needed. GUIDs count:', guids.length);
    if (guids.length > 10) {
        console.log('Showing VS Code confirmation dialog');
        
        // Store the resolution parameters to continue after confirmation
        window.pendingResolution = {
            columnIndex,
            columnName,
            resolveType,
            guids
        };
        
        // Send confirmation request to VS Code
        vscode.postMessage({
            type: 'showConfirmation',
            payload: {
                message: `This will make ${guids.length} API calls to resolve ${currentResults.data.length} rows. This may take some time. Do you want to continue?`,
                confirmationType: 'bulkResolve'
            }
        });
        return; // Stop execution here, will continue in message handler
    }
    
    // If no confirmation needed, continue with resolution
    continueResolveGuidColumn(columnIndex, columnName, resolveType);
}

function continueResolveGuidColumn(columnIndex, columnName, resolveType) {
    console.log('continueResolveGuidColumn called:', { columnIndex, columnName, resolveType });
    
    if (!currentResults || !currentResults.data) {
        console.log('No current results or data');
        return;
    }
    
    // Extract unique GUIDs from column
    const columnData = currentResults.data.map(row => row[columnIndex]);
    const guids = [...new Set(columnData.filter(value => isGuid(value)))];
    
    console.log('Found GUIDs for continuation:', guids);
    
    if (guids.length === 0) {
        console.log('No valid GUIDs found');
        vscode.postMessage({
            type: 'showError',
            payload: 'No valid GUIDs found in this column.'
        });
        return;
    }
    
    // Check if there's already a resolved column for this original column
    let newColumnIndex = -1;
    const expectedResolvedColumnName = columnName + '_Resolved';
    
    // Look for existing resolved column
    for (const [resolvedColIndex, columnInfo] of resolvedColumns.entries()) {
        if (columnInfo.originalColumnIndex === columnIndex && 
            currentResults.columns[resolvedColIndex] && 
            currentResults.columns[resolvedColIndex].name === expectedResolvedColumnName) {
            newColumnIndex = resolvedColIndex;
            break;
        }
    }
    
    if (newColumnIndex === -1) {
        // No existing resolved column, create a new one
        newColumnIndex = addResolvedColumn(columnIndex, columnName, resolveType);
    } else {
        // Reuse existing resolved column, fill it with loading spinners for all rows
        const cellsToUpdate = [];
        currentResults.data.forEach((row, rowIndex) => {
            const currentCell = row[newColumnIndex];
            // Only add loading animation if the cell is completely empty
            // Preserve existing loading animations and resolved content
            if (!currentCell || currentCell === '') {
                // Use truly random values for each animation to avoid synchronization
                const { offset, duration } = getRandomAnimationValues();
                const loadingHtml = `__HTML__<div class="guid-loading" style="--animation-delay: ${offset}s; --animation-duration: ${duration}s;"></div>`;
                row[newColumnIndex] = loadingHtml;
                cellsToUpdate.push({ row: rowIndex, col: newColumnIndex, html: loadingHtml });
            }
            // If the row already has content (loading animation, resolved text, etc.), preserve it
        });
        
        // Update the column info to mark it as no longer single-cell resolution
        if (resolvedColumns.has(newColumnIndex)) {
            const columnInfo = resolvedColumns.get(newColumnIndex);
            columnInfo.isSingleCellResolution = false;
            columnInfo.isLoading = true;
        }
        
        // Try to update only the modified cells to avoid restarting existing animations
        const table = document.querySelector('.results-table');
        let needsFullRender = false;
        
        if (table && cellsToUpdate.length > 0) {
            cellsToUpdate.forEach(({ row, col, html }) => {
                const targetCell = table.querySelector(`[data-row="${row}"][data-col="${col}"]`);
                if (targetCell) {
                    if (!updateCellWithFade(targetCell, html)) {
                        needsFullRender = true;
                    }
                } else {
                    needsFullRender = true;
                }
            });
        } else if (cellsToUpdate.length > 0) {
            needsFullRender = true;
        }
        
        // Only do full re-render if selective updates failed
        if (needsFullRender) {
            displayResults(currentResults, true);
        }
    }
    
    // Send message to extension to resolve GUIDs
    console.log('Sending resolveGuids message to extension');
    vscode.postMessage({
        type: 'resolveGuids',
        payload: {
            columnIndex: newColumnIndex, // Use the new column index, not the original
            columnName: columnName,
            guids: guids,
            resolveType: resolveType
        }
    });
}

function addResolvedColumn(originalColumnIndex, originalColumnName, resolveType) {
    if (!currentResults) {
        return -1;
    }
    
    const newColumnName = originalColumnName + '_Resolved';
    const newColumnIndex = originalColumnIndex + 1;
    
    // Add new column definition
    const newColumn = {
        name: newColumnName,
        type: 'string'
    };
    
    currentResults.columns.splice(newColumnIndex, 0, newColumn);
    
    // Add empty data for new column with loading spinners
    currentResults.data.forEach((row, rowIndex) => {
        // Use truly random values for each animation to avoid synchronization
        const { offset, duration } = getRandomAnimationValues();
        const loadingHtml = `__HTML__<div class="guid-loading" style="--animation-delay: ${offset}s; --animation-duration: ${duration}s;"></div>`;
        row.splice(newColumnIndex, 0, loadingHtml);
    });
    
    // Mark this column as being resolved
    resolvedColumns.set(newColumnIndex, {
        originalColumnIndex: originalColumnIndex,
        originalColumnName: originalColumnName,
        resolveType: resolveType,
        isLoading: true
    });
    
    // Re-render table
    displayResults(currentResults, true);
    
    // Return the new column index
    return newColumnIndex;
}

function addResolvedColumnForSingleCell(originalColumnIndex, originalColumnName, resolveType) {
    if (!currentResults) {
        return -1;
    }
    
    const newColumnName = originalColumnName + '_Resolved';
    const newColumnIndex = originalColumnIndex + 1;
    
    // Add new column definition
    const newColumn = {
        name: newColumnName,
        type: 'string'
    };
    
    currentResults.columns.splice(newColumnIndex, 0, newColumn);
    
    // Add empty data for new column (no loading spinners by default)
    currentResults.data.forEach(row => {
        row.splice(newColumnIndex, 0, '');
    });
    
    // Mark this column as being resolved for single cells (different from full column resolution)
    resolvedColumns.set(newColumnIndex, {
        originalColumnIndex: originalColumnIndex,
        originalColumnName: originalColumnName,
        resolveType: resolveType,
        isLoading: true,
        isSingleCellResolution: true
    });
    
    // Re-render table
    displayResults(currentResults, true);
    
    // Return the new column index
    return newColumnIndex;
}

function updateSingleResolvedCell(cellPosition, resolvedData, isPartial = false) {
    console.log('updateSingleResolvedCell called:', { cellPosition, resolvedData, isPartial });
    
    if (!currentResults || !currentResults.data || !cellPosition) {
        console.log('Invalid parameters for single cell update');
        return;
    }
    
    const { row, col } = cellPosition;
    if (!currentResults.data[row] || currentResults.data[row][col] === undefined) {
        console.log('Invalid cell position:', cellPosition);
        return;
    }
    
    // Create resolved map from response
    const resolvedMap = new Map();
    if (resolvedData && Array.isArray(resolvedData)) {
        resolvedData.forEach(item => {
            if (item.id) {
                resolvedMap.set(item.id, item);
            }
        });
    }
    
    // Find the original GUID from the original column (col - 1 since resolved column is col + 1)
    const originalCol = col - 1;
    const originalGuid = currentResults.data[row][originalCol];
    
    if (originalGuid && isGuid(originalGuid) && resolvedMap.has(originalGuid)) {
        const resolved = resolvedMap.get(originalGuid);
        if (resolved && !resolved.error) {
            const displayName = resolved.displayName || resolved.userPrincipalName || 'Unknown';
            const tooltip = JSON.stringify(resolved, null, 2);
            currentResults.data[row][col] = `__HTML__<span class="resolved-identity" data-tooltip="${tooltip.replace(/"/g, '&quot;')}">${displayName}</span>`;
            
            // Track this cell as individually resolved
            resolvedCells.add(`${row}-${originalCol}`);
        } else if (!isPartial) {
            // Only show errors during final updates, not partial ones
            // Extract the most meaningful error message from the error structure
            let errorMessage = 'Failed to resolve GUID';
            let tooltipMessage = errorMessage;
            
            if (resolved?.errorDetails) {
                // Use the summarized message
                if (resolved.errorDetails.message) {
                    errorMessage = resolved.errorDetails.message;
                    tooltipMessage = errorMessage;
                    
                    // If we have multiple errors, show them in the tooltip with proper formatting
                    if (resolved.errorDetails.allErrors && resolved.errorDetails.allErrors.length > 1) {
                        const attempts = resolved.errorDetails.allErrors.map(e => {
                            const friendlyType = getFriendlyTypeName(e.objectType);
                            const actualMessage = e.message || 'No access or not found';
                            return `${friendlyType}:&#10;${actualMessage}`;
                        });
                        tooltipMessage = `${errorMessage}&#10;&#10;${attempts.join('&#10;')}`;
                    }
                }
                // Fallback to API response error
                else if (resolved.errorDetails.fullApiResponse?.error?.message) {
                    errorMessage = resolved.errorDetails.fullApiResponse.error.message;
                    tooltipMessage = errorMessage;
                }
            } else if (resolved?.error) {
                errorMessage = resolved.error;
                tooltipMessage = errorMessage;
            }
            
            currentResults.data[row][col] = `__HTML__<span class="resolved-identity error-cell" data-tooltip="${tooltipMessage}" style="color: var(--vscode-errorForeground);">Failed to resolve</span>`;
        }
    } else if (!isPartial) {
        // Only check for fallback errors during final updates
        // Check if we have any resolved data for this GUID
        const guidResolved = resolvedData.find(item => item.id === originalGuid);
        if (guidResolved) {
            // Extract the most meaningful error message from the error structure
            let errorMessage = 'Failed to resolve GUID';
            let tooltipMessage = errorMessage;
            
            if (guidResolved?.errorDetails) {
                // Use the summarized message
                if (guidResolved.errorDetails.message) {
                    errorMessage = guidResolved.errorDetails.message;
                    tooltipMessage = errorMessage;
                    
                    // If we have multiple errors, show them in the tooltip with proper formatting
                    if (guidResolved.errorDetails.allErrors && guidResolved.errorDetails.allErrors.length > 1) {
                        const attempts = guidResolved.errorDetails.allErrors.map(e => {
                            const friendlyType = getFriendlyTypeName(e.objectType);
                            const actualMessage = e.message || 'No access or not found';
                            return `${friendlyType}:&#10;${actualMessage}`;
                        });
                        tooltipMessage = `${errorMessage}&#10;&#10;${attempts.join('&#10;')}`;
                    }
                }
                // Fallback to API response error
                else if (guidResolved.errorDetails.fullApiResponse?.error?.message) {
                    errorMessage = guidResolved.errorDetails.fullApiResponse.error.message;
                    tooltipMessage = errorMessage;
                }
            } else if (guidResolved?.error) {
                errorMessage = guidResolved.error;
                tooltipMessage = errorMessage;
            }
            
            currentResults.data[row][col] = `__HTML__<span class="resolved-identity error-cell" data-tooltip="${tooltipMessage}" style="color: var(--vscode-errorForeground);">Failed to resolve</span>`;
        } else {
            // Fallback error
            currentResults.data[row][col] = `__HTML__<span class="resolved-identity error-cell" data-tooltip="No resolution data received" style="color: var(--vscode-errorForeground);">Failed to resolve</span>`;
        }
    }
    
    // Update the specific cell in the DOM with fade transition when transitioning from loading to resolved
    const table = document.querySelector('.results-table');
    if (table) {
        const targetCell = table.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (targetCell && currentResults.data[row] && currentResults.data[row][col]) {
            // Check if we're transitioning from loading animation to resolved content
            const hasLoadingAnimation = targetCell.querySelector('.guid-loading');
            const isResolved = currentResults.data[row][col].includes('resolved-identity');
            const isError = currentResults.data[row][col].includes('error-cell');
            
            if (hasLoadingAnimation && isError) {
                // Transitioning from loading to error - use error animation
                updateCellWithErrorAnimation(targetCell, currentResults.data[row][col], 0, row, col);
            } else if (hasLoadingAnimation && isResolved) {
                // Transitioning from loading to resolved - use fade
                updateCellWithFade(targetCell, currentResults.data[row][col], 0, row, col);
            } else if (isCellSafeToUpdate(targetCell, row, col)) {
                // Not transitioning from loading, or not resolved content - update immediately if safe
                const cleanHtml = currentResults.data[row][col].replace('__HTML__', '');
                targetCell.innerHTML = cleanHtml;
            }
            // If cell is not safe to update (animating), skip the update to avoid restarting animation
        } else {
            // Fallback: re-render if we can't find the specific cell
            console.log('Single cell update: Cell not found, triggering full render');
            displayResults(currentResults, true);
        }
    } else {
        // Fallback: re-render if table doesn't exist
        console.log('Single cell update: table not found, triggering full render');
        displayResults(currentResults, true);
    }
}

function updateMultipleResolvedCells(selectedCells, resolvedData, isPartial = false) {
    console.log('updateMultipleResolvedCells called:', { selectedCells, resolvedData, isPartial });
    
    if (!currentResults || !currentResults.data || !selectedCells || selectedCells.length === 0) {
        console.log('Invalid parameters for multiple cell update');
        return;
    }
    
    // Create resolved map from response
    const resolvedMap = new Map();
    if (resolvedData && Array.isArray(resolvedData)) {
        resolvedData.forEach(item => {
            if (item.id) {
                resolvedMap.set(item.id, item);
            }
        });
    }
    
    // Update each selected cell
    selectedCells.forEach(({ row, col }) => {
        if (!currentResults.data[row] || currentResults.data[row][col] === undefined) {
            console.log('Invalid cell position:', { row, col });
            return;
        }
        
        // Find the original GUID from the original column (col - 1 since resolved column is col + 1)
        const originalCol = col - 1;
        const originalGuid = currentResults.data[row][originalCol];
        
        if (originalGuid && isGuid(originalGuid) && resolvedMap.has(originalGuid)) {
            const resolved = resolvedMap.get(originalGuid);
            if (resolved && !resolved.error) {
                const displayName = resolved.displayName || resolved.userPrincipalName || 'Unknown';
                const tooltip = JSON.stringify(resolved, null, 2);
                currentResults.data[row][col] = `__HTML__<span class="resolved-identity" data-tooltip="${tooltip.replace(/"/g, '&quot;')}">${displayName}</span>`;
                
                // Track this cell as individually resolved
                resolvedCells.add(`${row}-${originalCol}`);
            } else if (!isPartial) {
                // Only show errors during final updates, not partial ones
                // Extract the most meaningful error message from the error structure
                let errorMessage = 'Failed to resolve GUID';
                let tooltipMessage = errorMessage;
                
                if (resolved?.errorDetails) {
                    // Use the summarized message
                    if (resolved.errorDetails.message) {
                        errorMessage = resolved.errorDetails.message;
                        tooltipMessage = errorMessage;
                        
                        // If we have multiple errors, show them in the tooltip with proper formatting
                        if (resolved.errorDetails.allErrors && resolved.errorDetails.allErrors.length > 1) {
                            const attempts = resolved.errorDetails.allErrors.map(e => {
                                const friendlyType = getFriendlyTypeName(e.objectType);
                                const actualMessage = e.message || 'No access or not found';
                                return `${friendlyType}:&#10;${actualMessage}`;
                            });
                            tooltipMessage = `${errorMessage}&#10;&#10;${attempts.join('&#10;')}`;
                        }
                    }
                    // Fallback to API response error
                    else if (resolved.errorDetails.fullApiResponse?.responseBody?.error?.message) {
                        errorMessage = resolved.errorDetails.fullApiResponse.responseBody.error.message;
                        tooltipMessage = errorMessage;
                    }
                } else if (resolved?.error) {
                    errorMessage = resolved.error;
                    tooltipMessage = errorMessage;
                }
                
                currentResults.data[row][col] = `__HTML__<span class="resolved-identity error-cell" data-tooltip="${tooltipMessage}" style="color: var(--vscode-errorForeground);">Failed to resolve</span>`;
            }
        } else if (!isPartial) {
            // Only check for fallback errors during final updates
            // Check if we have any resolved data for this GUID
            const guidResolved = resolvedData.find(item => item.id === originalGuid);
            if (guidResolved) {
                // Extract the most meaningful error message from the error structure
                let errorMessage = 'Failed to resolve GUID';
                let tooltipMessage = errorMessage;
                
                if (guidResolved?.errorDetails) {
                    // Use the summarized message
                    if (guidResolved.errorDetails.message) {
                        errorMessage = guidResolved.errorDetails.message;
                        tooltipMessage = errorMessage;
                        
                        // If we have multiple errors, show them in the tooltip with proper formatting
                        if (guidResolved.errorDetails.allErrors && guidResolved.errorDetails.allErrors.length > 1) {
                            const attempts = guidResolved.errorDetails.allErrors.map(e => {
                                const friendlyType = getFriendlyTypeName(e.objectType);
                                const actualMessage = e.message || 'No access or not found';
                                return `${friendlyType}:&#10;${actualMessage}`;
                            });
                            tooltipMessage = `${errorMessage}&#10;&#10;${attempts.join('&#10;')}`;
                        }
                    }
                    // Fallback to API response error
                    else if (guidResolved.errorDetails.fullApiResponse?.responseBody?.error?.message) {
                        errorMessage = guidResolved.errorDetails.fullApiResponse.responseBody.error.message;
                        tooltipMessage = errorMessage;
                    }
                } else if (guidResolved?.error) {
                    errorMessage = guidResolved.error;
                    tooltipMessage = errorMessage;
                }
                
                currentResults.data[row][col] = `__HTML__<span class="resolved-identity error-cell" data-tooltip="${tooltipMessage}" style="color: var(--vscode-errorForeground);">Failed to resolve</span>`;
            } else {
                // Fallback error
                currentResults.data[row][col] = `__HTML__<span class="resolved-identity error-cell" data-tooltip="No resolution data received" style="color: var(--vscode-errorForeground);">Failed to resolve</span>`;
            }
        }
    });
    
    // Update the specific cells in the DOM with fade transitions when transitioning from loading to resolved
    const table = document.querySelector('.results-table');
    if (table) {
        let needsFullRender = false;
        selectedCells.forEach(({ row, col }, index) => {
            const targetCell = table.querySelector(`[data-row="${row}"][data-col="${col}"]`);
            if (targetCell && currentResults.data[row] && currentResults.data[row][col]) {
                // Check if we're transitioning from loading animation to resolved content
                const hasLoadingAnimation = targetCell.querySelector('.guid-loading');
                const isResolved = currentResults.data[row][col].includes('resolved-identity');
                const isError = currentResults.data[row][col].includes('error-cell');
                
                if (hasLoadingAnimation && isError) {
                    // Transitioning from loading to error - use error animation with staggered delay
                    const delay = index * 150;
                    updateCellWithErrorAnimation(targetCell, currentResults.data[row][col], delay, row, col);
                } else if (hasLoadingAnimation && isResolved) {
                    // Transitioning from loading to resolved - use fade with staggered delay
                    const delay = index * 150;
                    updateCellWithFade(targetCell, currentResults.data[row][col], delay, row, col);
                } else if (isCellSafeToUpdate(targetCell, row, col)) {
                    // Not transitioning from loading, or not resolved content - update immediately if safe
                    const cleanHtml = currentResults.data[row][col].replace('__HTML__', '');
                    targetCell.innerHTML = cleanHtml;
                }
                // If cell is not safe to update (animating), skip the update to avoid restarting animation
            } else {
                needsFullRender = true;
                console.log('Multiple cells: Cell not found or no data for', { row, col, targetCell: !!targetCell, hasData: !!(currentResults.data[row] && currentResults.data[row][col]) });
            }
        });
        
        // Only fallback to full render if some cells couldn't be updated individually
        if (needsFullRender) {
            console.log('Multiple cells update triggered full render - this will restart animations');
            displayResults(currentResults, true);
        }
    } else {
        // Fallback: re-render if table doesn't exist
        console.log('Multiple cells update: table not found, triggering full render');
        displayResults(currentResults, true);
    }
}

function updateResolvedColumn(columnIndex, resolvedData, isPartial = false) {
    console.log('updateResolvedColumn called:', { columnIndex, resolvedData, isPartial });
    console.log('Current resolvedColumns Map:', resolvedColumns);
    console.log('resolvedColumns.has(columnIndex):', resolvedColumns.has(columnIndex));
    
    if (!currentResults || !resolvedColumns.has(columnIndex)) {
        console.log('No current results or resolved column not found');
        console.log('currentResults exists:', !!currentResults);
        console.log('resolvedColumns.has(columnIndex):', resolvedColumns.has(columnIndex));
        console.log('Available keys in resolvedColumns:', Array.from(resolvedColumns.keys()));
        return;
    }
    
    const columnInfo = resolvedColumns.get(columnIndex);
    const originalColumnIndex = columnInfo.originalColumnIndex;
    
    console.log('Column info:', columnInfo);
    
    // For partial updates, merge with existing resolved data
    if (isPartial && columnInfo.resolvedData) {
        // Create a map of existing resolved data
        const existingMap = new Map();
        columnInfo.resolvedData.forEach(identity => {
            existingMap.set(identity.id, identity);
        });
        
        // Add new resolved data to existing map (overwriting if exists)
        resolvedData.forEach(identity => {
            existingMap.set(identity.id, identity);
        });
        
        // Update columnInfo with merged data
        columnInfo.resolvedData = Array.from(existingMap.values());
    } else {
        // For final updates, replace all resolved data
        columnInfo.resolvedData = resolvedData;
    }
    
    // Create lookup map for resolved identities from current batch
    const resolvedMap = new Map();
    resolvedData.forEach(identity => {
        resolvedMap.set(identity.id, identity);
    });
    
    console.log('Resolved map:', resolvedMap);
    
    // Update data in resolved column
    currentResults.data.forEach(row => {
        const originalValue = row[originalColumnIndex];
        if (isGuid(originalValue)) {
            if (resolvedMap.has(originalValue)) {
                // Only update rows for GUIDs that were included in this batch
                const resolved = resolvedMap.get(originalValue);
                if (resolved && !resolved.error) {
                    const displayName = resolved.displayName || resolved.userPrincipalName || 'Unknown';
                    const tooltip = JSON.stringify(resolved, null, 2);
                    row[columnIndex] = `__HTML__<span class="resolved-identity" data-tooltip="${tooltip.replace(/"/g, '&quot;')}">${displayName}</span>`;
                } else if (!isPartial) {
                    // Only show errors during final updates, not partial ones
                    // Extract the most meaningful error message from the error structure
                    let errorMessage = 'Failed to resolve GUID';
                    let tooltipMessage = errorMessage;
                    
                    if (resolved?.errorDetails) {
                        // Use the summarized message
                        if (resolved.errorDetails.message) {
                            errorMessage = resolved.errorDetails.message;
                            tooltipMessage = errorMessage;
                            
                            // If we have multiple errors, show them in the tooltip with proper formatting
                            if (resolved.errorDetails.allErrors && resolved.errorDetails.allErrors.length > 1) {
                                const attempts = resolved.errorDetails.allErrors.map(e => {
                                    const friendlyType = getFriendlyTypeName(e.objectType);
                                    const actualMessage = e.message || 'No access or not found';
                                    return `${friendlyType}:&#10;${actualMessage}`;
                                });
                                tooltipMessage = `${errorMessage}&#10;&#10;${attempts.join('&#10;&#10;')}`;
                            }
                        }
                        // Fallback to API response error
                        else if (resolved.errorDetails.fullApiResponse?.responseBody?.error?.message) {
                            errorMessage = resolved.errorDetails.fullApiResponse.responseBody.error.message;
                            tooltipMessage = errorMessage;
                        }
                    } else if (resolved?.error) {
                        errorMessage = resolved.error;
                        tooltipMessage = errorMessage;
                    }
                    
                    row[columnIndex] = `__HTML__<span class="resolved-identity error-cell" data-tooltip="${tooltipMessage}" style="color: var(--vscode-errorForeground);">Failed to resolve</span>`;
                }
            } else if (!isPartial) {
                // For final updates, fill in any remaining unresolved GUIDs with placeholder
                if (row[columnIndex] === undefined || row[columnIndex] === '') {
                    row[columnIndex] = '__HTML__<em style="color: var(--vscode-descriptionForeground);">Not resolved</em>';
                }
            }
            // For partial updates, don't touch GUIDs not in this batch - leave them as they are
        } else if (!isPartial) {
            // For non-GUIDs, only set placeholder on final update
            row[columnIndex] = '__HTML__<em style="color: var(--vscode-descriptionForeground);">-</em>';
        }
    });
    
    // Mark as no longer loading only for final updates
    if (!isPartial) {
        columnInfo.isLoading = false;
    }
    resolvedColumns.set(columnIndex, columnInfo);
    
    console.log('Updating individual cells with resolved data');
    
    // Update individual cells with fade transitions when transitioning from loading to resolved
    const table = document.querySelector('.results-table');
    if (table) {
        let needsFullRender = false;
        currentResults.data.forEach((row, rowIndex) => {
            const targetCell = table.querySelector(`[data-row="${rowIndex}"][data-col="${columnIndex}"]`);
            if (targetCell && row[columnIndex]) {
                // Check if we're transitioning from loading animation to resolved content
                const hasLoadingAnimation = targetCell.querySelector('.guid-loading');
                const isResolved = row[columnIndex].includes('resolved-identity');
                const isError = row[columnIndex].includes('error-cell');
                
                if (hasLoadingAnimation && isError) {
                    // Transitioning from loading to error - use error animation with staggered delay
                    const delay = rowIndex * 100;
                    updateCellWithErrorAnimation(targetCell, row[columnIndex], delay, rowIndex, columnIndex);
                } else if (hasLoadingAnimation && isResolved) {
                    // Transitioning from loading to resolved - use fade with staggered delay
                    const delay = rowIndex * 100;
                    updateCellWithFade(targetCell, row[columnIndex], delay, rowIndex, columnIndex);
                } else if (isCellSafeToUpdate(targetCell, rowIndex, columnIndex)) {
                    // Not transitioning from loading, or not resolved content - update immediately if safe
                    const cleanHtml = row[columnIndex].replace('__HTML__', '');
                    targetCell.innerHTML = cleanHtml;
                }
                // If cell is not safe to update (animating), skip the update to avoid restarting animation
            } else {
                needsFullRender = true;
                console.log('Column update: Cell not found for', { rowIndex, columnIndex, targetCell: !!targetCell, hasData: !!(row[columnIndex]) });
            }
        });
        
        // Only fallback to full render if some cells couldn't be updated individually
        if (needsFullRender) {
            console.log('Column update triggered full render - this will restart animations');
            displayResults(currentResults, true);
        }
    } else {
        // Fallback: re-render if table doesn't exist
        console.log('Column update: table not found, triggering full render');
        displayResults(currentResults, true);
    }
}
