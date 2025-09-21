# bARGE - boosted Azure Resource Graph Explorer

[![bARGE]][bARGEMarketplace] [![bARGEDownloads]][bARGEMarketplace]

<img src="media/readme/bARGE.png" width="256">

bARGE is a Visual Studio Code extension that brings Azure Resource Graph querying capabilities with KQL directly to your development environment, similar to the Azure Portal's Resource Graph Explorer. It boosts the functionality with features for better insight such as comparison of results, improved data table handling, easy sign-in and switching of accounts.

## Features

- **Run KQL Queries**: Execute Kusto Query Language (KQL) queries against Azure Resource Graph directly from VS Code.
- **KQL Language Support**: Syntax highlighting, intellisense with completions and hover documentation with context and links.
- **Results Panel**: View query results in a dedicated panel with sortable and resizable columns.
- **Resolve Identities against Entra ID**: Resolve GUIDs in query results against Entra ID for more details about identities.
- **Comparison**: Select two or more rows for comparison to see differences in their properties.
- **Copy & Export**: Easily copy selected cells as formatted text or for Excel, or export entire results to CSV for further analysis.
- **Scope Selection**: Choose the subscription or tenant scope for your queries.
- **Authentication Options**: Authenticate using [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest&wt.mc_id=DT-MVP-5005372) or VS Code's built-in Microsoft account provider.
- **Adaptive Layout and Theme**: The results panel adapts to your VS Code layout for both vertical and horizontal splits, and respects your theme settings for light and dark mode.

## Installation

1. [Install the extension](https://marketplace.visualstudio.com/items?itemName=PalmEmanuel.barge-vscode) from the VS Code marketplace
2. Search for `bARGE` and install it through the VS Code Extensions menu (CTRL / CMD + SHIFT + X)
3. Run the following command in VS Code's Quick Open panel (CTRL / CMD + P):

```
ext install PalmEmanuel.barge-vscode
```

4. Or [build from source](#building-from-source) for development

## Using bARGE

### Sign In

There are multiple options for sign-in, either via the Azure CLI or via VS Code's logged in Microsoft accounts. The easiest way is to use the `Sign In` command.

The status bar at the bottom of VS Code shows the account currently logged into bARGE, and allows easy switching between accounts.

![Sign In](media/readme/gifs/sign-in.gif)

By default, the extension will attempt to use the available tokens from the [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest&wt.mc_id=DT-MVP-5005372) chain, which in order includes:

- Environment Variables
- Workload Identity
- Managed Identity
- Visual Studio Code
- Azure CLI
- Azure PowerShell
- Azure Developer CLI

It's possible to turn off the automatic sign-in through the configuration settings for bARGE.

Running the `Sign In` command, either through the command palette or through the bARGE status bar account selector, allows selecting either the DefaultAzureCredential described above, or any of the signed-in Microsoft accounts in VS Code.

### Running KQL Queries

There are two main ways to execute KQL queries against Azure Resource Graph using bARGE:

- **From a .kql file**: Open the file and right click to run `bARGE: Run Query from Current File` or click `F5`
- **From selected text**: Select KQL text and right click to run `bARGE: Run Selected Query text` or click `F8`

Both commands are represented as buttons in the editor title area while in KQL files, and are also possible to execute from the command palette.

![Query with Row Details](media/readme/gifs/query-details.gif)

### Interacting with Results

bARGE supports functionality expected from modern tables and Azure Resource Graph Explorer in the Azure Portal:

- Resize and reorder columns by dragging headers
- Select cells and copy data to Excel or other tools, with or without headers
- Hover or right click JSON values in results, such as `properties`, to view or copy formatted content
- Export results to CSV using the export button in the results panel
- Select a row in the results table for details
- Select multiple rows in the results table for comparison and quick overview of matching or differing properties

![Query with Row Comparison](media/readme/gifs/query-comparison.gif)

## Resolve Identities

bARGE can resolve GUIDs in query results against Entra ID to find the names and more details about identities, either by individual rows or entire columns.

**NOTE**: This requires read access in Entra ID.

![Resolve Identities](media/readme/gifs/resolve-ids.gif)

This feature is particularly useful when exporting the results to CSV for reports or further analysis, as it can add context to otherwise cryptic GUIDs.

## Configuration

The extension supports the following configuration options in VS Code settings:

- `barge.autoAuthenticate`: Automatically authenticate with Azure on extension activation (default: true)
- `barge.hideLoginMessages`: Hide login notifications and messages, except errors (default: false)
- `barge.enableHoverTooltips`: Enable IntelliSense hover tooltips for Azure Resource Graph elements and KQL syntax like keywords, operators, functions, and tables (default: true)
- `barge.enableCompletions`: Enable IntelliSense completions for Azure Resource Graph elements and KQL syntax like keywords, operators, functions, and tables (default: true)

The default keybindings for executing queries are also possible to change.

## Development

### Building from Source

```bash
git clone https://github.com/PalmEmanuel/bARGE.git
cd bARGE
npm install
```

Press `F5` in VS Code to launch the Extension Development Host and debug the extension.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

If you have a feature request, create an Issue!

## Troubleshooting

If you encounter issues with using the extension, verify that your account has access, that you're logged in to the correct account (as indicated in the status bar in the bottom of VS Code), and that your query is correct.

If the problem persists, please create an Issue and try to describe the unexpected behavior and a way to reproduce it.

## Resources

- [Azure Resource Graph Documentation](https://docs.microsoft.com/en-us/azure/governance/resource-graph?wt.mc_id=DT-MVP-5005372)
- [Azure Resource Graph Sample Queries](https://docs.microsoft.com/en-us/azure/governance/resource-graph/samples/starter?wt.mc_id=DT-MVP-5005372)
- [Azure Resource Graph Query Language](https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/query-language?wt.mc_id=DT-MVP-5005372)

<!-- References -->
[bARGEDownloads]: https://img.shields.io/visual-studio-marketplace/d/PalmEmanuel.barge-vscode?label=bARGE%20Downloads
[bARGEMarketplace]: https://marketplace.visualstudio.com/items?itemName=PalmEmanuel.barge-vscode
[bARGE]: https://img.shields.io/visual-studio-marketplace/v/PalmEmanuel.barge-vscode?label=bARGE
