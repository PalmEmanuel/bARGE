// Import lottie-web and bundle it
import lottie from 'lottie-web';

// Import both compass animation JSON data
import compassWhiteAnimationData from '../../media/webview/compass-white-1024.json';
import compassBlackAnimationData from '../../media/webview/compass-black-1024.json';

// Make lottie available globally for the webview
window.lottie = lottie;

// Make both animation data available
window.compassWhiteAnimation = compassWhiteAnimationData;
window.compassBlackAnimation = compassBlackAnimationData;

// Theme detection function
window.isLightTheme = function() {
    // VS Code exposes theme information via body class names since 2016
    const body = document.body;
    
    // Priority 1: Check for clear VS Code theme classes first
    if (body.classList.contains('vscode-light')) {
        return true;
    }
    if (body.classList.contains('vscode-dark')) {
        return false;
    }
    
    // Priority 2: For high contrast or unknown themes, analyze actual background colors
    const style = getComputedStyle(document.body);
    
    // Try multiple color sources for better detection
    const colors = [
        style.getPropertyValue('--vscode-editor-background'),
        style.backgroundColor,
        style.getPropertyValue('--vscode-sideBar-background')
    ];
    
    for (const color of colors) {
        if (color && color !== 'transparent') {
            const brightness = getBrightness(color);
            if (brightness !== null) {
                console.log(`Theme detection: color="${color}", brightness=${brightness}`);
                return brightness > 128; // Light background = light theme
            }
        }
    }
    
    // Priority 3: Final fallback to dark theme
    return false;
};

// Helper function to calculate brightness from any CSS color
function getBrightness(color) {
    if (!color || color === 'transparent') {
        return null;
    }
    
    // Handle RGB/RGBA format
    const rgbMatch = color.match(/rgba?\(([^)]+)\)/);
    if (rgbMatch) {
        const values = rgbMatch[1].split(',').map(v => parseInt(v.trim()));
        if (values.length >= 3) {
            return (values[0] * 299 + values[1] * 587 + values[2] * 114) / 1000;
        }
    }
    
    // Handle hex format
    const hexMatch = color.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (hexMatch) {
        const r = parseInt(hexMatch[1], 16);
        const g = parseInt(hexMatch[2], 16);
        const b = parseInt(hexMatch[3], 16);
        return (r * 299 + g * 587 + b * 114) / 1000;
    }
    
    return null;
}

// Apply theme class to body for consistent styling
window.applyThemeClass = function() {
    const isLight = window.isLightTheme();
    const body = document.body;
    
    // Remove existing theme classes
    body.classList.remove('detected-light-theme', 'detected-dark-theme');
    
    // Add detected theme class
    if (isLight) {
        body.classList.add('detected-light-theme');
    } else {
        body.classList.add('detected-dark-theme');
    }
    
    return isLight;
};

// Lottie-specific loading indicator functions
window.createLoadingAnimation = function(container) {
    // Apply theme class and choose animation based on theme
    const isLight = window.applyThemeClass();
    const animationData = isLight ? compassBlackAnimationData : compassWhiteAnimationData;
    
    // Log which animation is being used (can be removed later)
    const bodyClasses = document.body.className;
    
    return lottie.loadAnimation({
        container: container,
        renderer: 'svg', // SVG for crisp scaling
        loop: true,
        autoplay: true,
        animationData: animationData // Use theme-appropriate data
    });
};

window.createAnimationFromData = function(container, animationData) {
    return lottie.loadAnimation({
        container: container,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: animationData
    });
};