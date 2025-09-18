/**
 * Utilities for GUID detection and resolution
 */

/**
 * Regular expression to match GUID format (UUID v4 or similar)
 */
const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Check if a string value matches GUID format
 */
export function isGuid(value: any): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    return GUID_REGEX.test(value);
}

/**
 * Analyze a column to determine if it contains GUIDs
 * Returns true if at least 70% of non-null values are GUIDs
 */
export function isGuidColumn(columnData: any[], threshold: number = 0.7): boolean {
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

/**
 * Extract unique GUIDs from a column's data
 */
export function extractUniqueGuids(columnData: any[]): string[] {
    const guids = new Set<string>();
    
    for (const value of columnData) {
        if (isGuid(value)) {
            guids.add(value);
        }
    }
    
    return Array.from(guids);
}

/**
 * Common column names that often contain identity GUIDs
 */
export const IDENTITY_GUID_COLUMN_NAMES = [
    'principalid',
    'objectid', 
    'userid',
    'groupid',
    'applicationid',
    'serviceprincipalid',
    'clientid',
    'assignedto',
    'assignedby',
    'createdby',
    'modifiedby',
    'ownerid',
    'memberid'
];

/**
 * Check if a column name suggests it contains identity GUIDs
 */
export function isLikelyIdentityColumn(columnName: string): boolean {
    const lowerColumnName = columnName.toLowerCase().replace(/[_\s-]/g, '');
    return IDENTITY_GUID_COLUMN_NAMES.some(name => 
        lowerColumnName.includes(name) || lowerColumnName.endsWith('id')
    );
}

/**
 * Determine if a column should show the resolve button
 */
export function shouldShowResolveButton(columnName: string, columnData: any[]): boolean {
    // First check if it's likely an identity column by name
    const likelyIdentity = isLikelyIdentityColumn(columnName);
    
    // Then check if the data contains GUIDs
    const containsGuids = isGuidColumn(columnData);
    
    // Show button if both conditions are met
    return likelyIdentity && containsGuids;
}