# bARGE - basic Azure Resource Graph Explorer

bARGE is a VS Code extension that brings Azure Resource Graph querying capabilities directly into your development environment, similar to the Azure Portal's Resource Graph Explorer.

## Features

- **Interactive Query Interface**: Write and execute KQL (Kusto Query Language) queries against Azure Resource Graph
- **Table View**: View results in a sortable, interactive table format
- **Side-by-side Layout**: Query editor and results table in the same panel for efficient workflow
- **Client-side Sorting**: Sort results by any column without re-running queries
- **CSV Export**: Export query results to CSV files for further analysis
- **Azure Authentication**: Seamless integration with Azure authentication (Azure CLI, browser-based, etc.)
- **Multi-subscription Support**: Query across different Azure subscriptions

## Getting Started

### Prerequisites

- VS Code 1.103.0 or higher
- Access to Azure subscriptions
- One of the following for authentication:
  - Azure CLI installed and logged in (`az login`)
  - Or browser-based authentication (fallback)

### Installation

1. Install the extension from the VS Code marketplace
2. Or [build from source](#building-from-source) for development

### Usage

1. **Open bARGE Explorer**
   - Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
   - Run `bARGE: Open Azure Resource Graph Explorer`

2. **Authenticate with Azure**
   - Click "Authenticate with Azure" in the panel
   - The extension will try Azure CLI credentials first, then browser authentication if needed

3. **Select Subscription**
   - Choose your Azure subscription from the dropdown
   - Use "Refresh" to reload available subscriptions

4. **Write and Execute Queries**
   - Enter your KQL query in the text area
   - Click "Run Query" to execute
   - Results appear in the table below

5. **Interact with Results**
   - Click column headers to sort data
   - Click "Export to CSV" to save results

## Example Queries

Here are some useful queries to get you started:

### List all Virtual Machines

```kql
Resources
| where type == 'microsoft.compute/virtualmachines'
| project name, location, resourceGroup, properties.hardwareProfile.vmSize
| limit 100
```

### Find resources by tag

```kql
Resources
| where tags.Environment == 'Production'
| project name, type, location, resourceGroup
| limit 50
```

### Storage accounts by region

```kql
Resources
| where type == 'microsoft.storage/storageaccounts'
| summarize count() by location
| order by count_ desc
```

### Resources created in the last 30 days

```kql
Resources
| where todatetime(properties.timeCreated) > ago(30d)
| project name, type, resourceGroup, properties.timeCreated
| order by todatetime(properties.timeCreated) desc
```

## Configuration

The extension supports the following configuration options in VS Code settings:

- `barge.defaultSubscription`: Default Azure subscription ID to use for queries
- `barge.autoAuthenticate`: Automatically authenticate with Azure on extension activation (default: true)

## Commands

- `barge.openExplorer`: Open Azure Resource Graph Explorer
- `barge.runQuery`: Focus the bARGE panel (or open if not already open)

## Development

### Building from Source

```bash
git clone https://github.com/PalmEmanuel/bARGE.git
cd bARGE
npm install
npm run watch
```

Then press `F5` in VS Code to launch the Extension Development Host.

### Project Structure

- `src/extension.ts` - Main extension entry point
- `src/bargePanel.ts` - Webview panel implementation
- `src/azureService.ts` - Azure Resource Graph API integration
- `src/types.ts` - TypeScript type definitions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Troubleshooting

### Authentication Issues

If you encounter authentication problems:

1. Make sure you're logged into Azure CLI: `az login`
2. Verify you have access to the subscription you're trying to query
3. Try refreshing your browser authentication

### Query Errors

- Ensure your KQL syntax is correct
- Verify you have permissions to query the resources
- Check that the subscription is selected

### Performance

- Use `limit` clauses for large result sets
- Consider filtering early in your queries to improve performance

## Resources

- [Azure Resource Graph Documentation](https://docs.microsoft.com/en-us/azure/governance/resource-graph/)
- [KQL (Kusto Query Language) Reference](https://docs.microsoft.com/en-us/azure/data-explorer/kusto/query/)
- [Azure Resource Graph Sample Queries](https://docs.microsoft.com/en-us/azure/governance/resource-graph/samples/starter)ode README

This is the README for your extension "barge-vscode". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

- `myExtension.enable`: Enable/disable this extension.
- `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

- Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
- Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
- Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

- [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
