import {
	ErrorCode,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config.js';
import { N8nApiClient } from '../n8n-api-client.js';
import { node_validator } from '../node-validator.js';
import {
	CreateWorkflowInputSchema,
	WorkflowSchema,
} from '../schemas.js';
import { WORKFLOW_COMPOSITION_GUIDE } from '../workflow-composition-guide.js';

/**
 * Helper function to handle validation errors with helpful guidance
 * @param error The Zod validation error
 * @returns Formatted error response with guidance from the workflow composition guide
 */
function handle_validation_error(error: any) {
	// Extract the error message
	const error_message = error.message || 'Validation error';

	// Determine which sections of the guide to include based on the error
	let guidance = '';

	// Check for common error patterns
	if (error_message.includes('nodes')) {
		guidance += WORKFLOW_COMPOSITION_GUIDE.node_categories;
	} else if (error_message.includes('connections')) {
		guidance += WORKFLOW_COMPOSITION_GUIDE.common_patterns;
	} else if (error_message.includes('trigger')) {
		guidance += WORKFLOW_COMPOSITION_GUIDE.core_principles;
	} else {
		// Default guidance
		guidance += WORKFLOW_COMPOSITION_GUIDE.workflow_creation_process;
	}

	return {
		content: [
			{
				type: 'text',
				text: `Validation error: ${error_message}\n\nHere's some guidance that might help:\n\n${guidance}`,
			},
		],
		isError: true,
	};
}

/**
 * Helper function to format output based on verbosity setting
 * @param summary The human-readable summary text
 * @param details The full JSON details
 * @param verbosity The verbosity level (concise or full)
 * @returns Formatted text based on verbosity setting
 */
function format_output(
	summary: string,
	details: any,
	verbosity?: string,
): string {
	// Use the provided verbosity parameter if available, otherwise fall back to config
	const output_verbosity = verbosity || config.output_verbosity;

	if (output_verbosity === 'full') {
		return (
			summary +
			'\n\nFull details:\n' +
			JSON.stringify(details, null, 2)
		);
	} else {
		// Default to concise mode
		return summary;
	}
}

/**
 * Handles the list_workflows tool
 */
export async function handle_list_workflows(
	api_client: N8nApiClient,
	args: any,
) {
	try {
		const workflows = await api_client.list_workflows(args);

		if (!workflows || workflows.length === 0) {
			return {
				content: [
					{
						type: 'text',
						text: 'No workflows found.',
					},
				],
			};
		}

		// Create a summary of the workflows
		const active_count = workflows.filter(
			(wf: { active: boolean }) => wf.active,
		).length;
		const inactive_count = workflows.length - active_count;

		const summary = `Found ${workflows.length} workflow${
			workflows.length !== 1 ? 's' : ''
		} (${active_count} active, ${inactive_count} inactive):\n\n`;

		// Create a list of workflows with their basic info
		const workflow_list = workflows
			.map((wf: any, index: number) => {
				const status = wf.active ? 'Active' : 'Inactive';
				const tags =
					wf.tags
						?.map((tag: { name: string }) => tag.name)
						.join(', ') || 'None';
				return `${index + 1}. "${wf.name}" (ID: ${wf.id})
   Status: ${status}
   Created: ${new Date(wf.created_at).toLocaleString()}
   Tags: ${tags}`;
			})
			.join('\n\n');

		return {
			content: [
				{
					type: 'text',
					text: format_output(
						summary + workflow_list,
						workflows,
						args.verbosity,
					),
				},
			],
		};
	} catch (error: any) {
		return {
			content: [
				{
					type: 'text',
					text: `Error listing workflows: ${
						error.message || String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}

/**
 * Handles the create_workflow tool
 */
export async function handle_create_workflow(
	api_client: N8nApiClient,
	args: any,
) {
	try {
		// Validate input with Zod
		const parsed_input = CreateWorkflowInputSchema.parse(args);

		// Validate that all nodes exist in n8n
		const invalid_nodes =
			await node_validator.validate_workflow_nodes(
				parsed_input.workflow.nodes,
			);

		if (invalid_nodes.length > 0) {
			// Format error message with suggestions
			const error_messages = invalid_nodes.map((node) => {
				const suggestion = node.suggestion
					? `Did you mean '${node.suggestion}'?`
					: 'No similar nodes found.';
				return `- '${node.node_type}': Not a valid n8n node. ${suggestion}`;
			});

			// Include relevant sections from the workflow composition guide
			const node_categories =
				WORKFLOW_COMPOSITION_GUIDE.node_categories;

			return {
				content: [
					{
						type: 'text',
						text:
							`Workflow contains invalid node types:\n${error_messages.join(
								'\n',
							)}\n\nPlease correct these node types before creating the workflow.\n\n` +
							`Here are the available node categories for reference:\n${node_categories}`,
					},
				],
				isError: true,
			};
		}

		const workflow = await api_client.create_workflow(
			parsed_input.workflow,
			parsed_input.activate,
		);

		const activation_status = workflow.active
			? 'activated'
			: 'created (not activated)';

		return {
			content: [
				{
					type: 'text',
					text: `Successfully ${activation_status} workflow "${workflow.name}" (ID: ${workflow.id})`,
				},
			],
		};
	} catch (error: any) {
		if (error.name === 'ZodError') {
			return handle_validation_error(error);
		}
		return {
			content: [
				{
					type: 'text',
					text: `Error creating workflow: ${
						error.message || String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}

/**
 * Handles the get_workflow tool
 */
export async function handle_get_workflow(
	api_client: N8nApiClient,
	args: any,
) {
	if (!args.id) {
		throw new McpError(
			ErrorCode.InvalidParams,
			'Workflow ID is required',
		);
	}

	try {
		const workflow = await api_client.get_workflow(args.id);

		// Format a summary of the workflow
		const activation_status = workflow.active ? 'Active' : 'Inactive';
		const node_count = workflow.nodes.length;
		const trigger_nodes = workflow.nodes.filter(
			(node: { type: string }) =>
				node.type.toLowerCase().includes('trigger'),
		).length;

		const summary = `Workflow: "${workflow.name}" (ID: ${args.id})
Status: ${activation_status}
Created: ${new Date(workflow.created_at).toLocaleString()}
Updated: ${new Date(workflow.updated_at).toLocaleString()}
Nodes: ${node_count} (including ${trigger_nodes} trigger nodes)
Tags: ${
			workflow.tags
				?.map((tag: { name: string }) => tag.name)
				.join(', ') || 'None'
		}`;

		return {
			content: [
				{
					type: 'text',
					text: format_output(summary, workflow, args.verbosity),
				},
			],
		};
	} catch (error: any) {
		return {
			content: [
				{
					type: 'text',
					text: `Error retrieving workflow: ${
						error.message || String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}

/**
 * Handles the update_workflow tool
 */
export async function handle_update_workflow(
	api_client: N8nApiClient,
	args: any,
) {
	if (!args.id || !args.workflow) {
		throw new McpError(
			ErrorCode.InvalidParams,
			'Workflow ID and updated workflow data are required',
		);
	}

	try {
		// Validate workflow with Zod
		const parsed_workflow = WorkflowSchema.parse(args.workflow);

		// Validate that all nodes exist in n8n
		const invalid_nodes =
			await node_validator.validate_workflow_nodes(
				parsed_workflow.nodes,
			);

		if (invalid_nodes.length > 0) {
			// Format error message with suggestions
			const error_messages = invalid_nodes.map((node) => {
				const suggestion = node.suggestion
					? `Did you mean '${node.suggestion}'?`
					: 'No similar nodes found.';
				return `- '${node.node_type}': Not a valid n8n node. ${suggestion}`;
			});

			// Include relevant sections from the workflow composition guide
			const node_categories =
				WORKFLOW_COMPOSITION_GUIDE.node_categories;

			return {
				content: [
					{
						type: 'text',
						text:
							`Workflow contains invalid node types:\n${error_messages.join(
								'\n',
							)}\n\nPlease correct these node types before updating the workflow.\n\n` +
							`Here are the available node categories for reference:\n${node_categories}`,
					},
				],
				isError: true,
			};
		}

		const workflow = await api_client.update_workflow(
			args.id,
			parsed_workflow,
		);

		const activation_status = workflow.active ? 'active' : 'inactive';

		return {
			content: [
				{
					type: 'text',
					text: `Successfully updated workflow "${workflow.name}" (ID: ${args.id}, Status: ${activation_status})`,
				},
			],
		};
	} catch (error: any) {
		if (error.name === 'ZodError') {
			return handle_validation_error(error);
		}
		return {
			content: [
				{
					type: 'text',
					text: `Error updating workflow: ${
						error.message || String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}

/**
 * Handles the delete_workflow tool
 */
export async function handle_delete_workflow(
	api_client: N8nApiClient,
	args: any,
) {
	if (!args.id) {
		throw new McpError(
			ErrorCode.InvalidParams,
			'Workflow ID is required',
		);
	}

	// First get the workflow to show its name
	try {
		const workflow = await api_client.get_workflow(args.id);

		// Now delete the workflow
		const result = await api_client.delete_workflow(args.id);

		return {
			content: [
				{
					type: 'text',
					text: `Successfully deleted workflow "${workflow.name}" (ID: ${args.id})`,
				},
			],
		};
	} catch (error: any) {
		return {
			content: [
				{
					type: 'text',
					text: `Error deleting workflow: ${
						error.message || String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}

/**
 * Handles the activate_workflow tool
 */
export async function handle_activate_workflow(
	api_client: N8nApiClient,
	args: any,
) {
	if (!args.id) {
		throw new McpError(
			ErrorCode.InvalidParams,
			'Workflow ID is required',
		);
	}

	try {
		const result = await api_client.activate_workflow(args.id);
		return {
			content: [
				{
					type: 'text',
					text: `Successfully activated workflow "${result.name}" (ID: ${args.id})`,
				},
			],
		};
	} catch (error: any) {
		// Check for common activation errors
		if (error.message && error.message.includes('trigger')) {
			// This is likely an error about missing trigger nodes
			const core_principles =
				WORKFLOW_COMPOSITION_GUIDE.core_principles;

			return {
				content: [
					{
						type: 'text',
						text:
							`Error activating workflow: ${error.message}\n\n` +
							`Note: Only workflows with automatic trigger nodes (Schedule, Webhook, etc.) can be activated. ` +
							`Workflows with only manual triggers cannot be automatically activated.\n\n` +
							`Here are some core principles for workflow composition:\n${core_principles}`,
					},
				],
				isError: true,
			};
		}

		return {
			content: [
				{
					type: 'text',
					text: `Error activating workflow: ${
						error.message || String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}

/**
 * Handles the deactivate_workflow tool
 */
export async function handle_deactivate_workflow(
	api_client: N8nApiClient,
	args: any,
) {
	if (!args.id) {
		throw new McpError(
			ErrorCode.InvalidParams,
			'Workflow ID is required',
		);
	}

	try {
		const result = await api_client.deactivate_workflow(args.id);
		return {
			content: [
				{
					type: 'text',
					text: `Successfully deactivated workflow "${result.name}" (ID: ${args.id})`,
				},
			],
		};
	} catch (error: any) {
		return {
			content: [
				{
					type: 'text',
					text: `Error deactivating workflow: ${
						error.message || String(error)
					}`,
				},
			],
			isError: true,
		};
	}
}
