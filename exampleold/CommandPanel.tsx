import React from 'react';

interface Command {
  id: string;
  command: string;
  description: string;
  icon?: React.ReactNode; // Optional: for icons like in your screenshot
}

// TODO: Later, these commands might come from a config or be dynamically generated
const commands: Command[] = [
  {
    id: 'request',
    command: '/request',
    description: 'Request a payment from someone.',
    // icon: <RequestIcon />, // Example
  },
  {
    id: 'pay',
    command: '/pay',
    description: 'Send a payment.',
    // icon: <PayIcon />, // Example
  },
];

interface CommandPanelProps {
  onCommandSelect: (command: Command) => void;
  filter?: string; // To filter commands as user types
}

const CommandPanel: React.FC<CommandPanelProps> = ({ onCommandSelect, filter }) => {
  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.command.toLowerCase().startsWith(filter?.toLowerCase() || '') ||
      cmd.description.toLowerCase().includes(filter?.toLowerCase() || '')
  );

  if (filteredCommands.length === 0 && !filter) {
    // Don't show if no filter and empty (or show all)
    return null;
  }

  return (
    <div className="absolute bottom-full mb-2 w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
      <ul className="divide-y divide-gray-200 dark:divide-gray-700">
        {filteredCommands.map((cmd) => (
          <li
            key={cmd.id}
            className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
            onClick={() => onCommandSelect(cmd)}
            role="button"
            tabIndex={0}
            onKeyPress={(e) => e.key === 'Enter' && onCommandSelect(cmd)}
          >
            <div className="flex items-center space-x-3">
              {/* Optional: Icon can go here */}
              {/* <div className="flex-shrink-0">{cmd.icon}</div> */}
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{cmd.command}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{cmd.description}</p>
              </div>
            </div>
          </li>
        ))}
        {filteredCommands.length === 0 && filter && (
          <li className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
            No commands found for &quot;{filter}&quot;
          </li>
        )}
      </ul>
    </div>
  );
};

export default CommandPanel;