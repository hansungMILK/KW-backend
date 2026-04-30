import { useContext } from 'react';

import { ThemeProviderContext } from '../provider/ThemeProvider.js';

export const useTheme = () => {
    const context = useContext(ThemeProviderContext);

    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    const { theme } = context;

    return {
        ...context,
        theme,
        isDarkTheme: theme === 'dark',
    };
};
