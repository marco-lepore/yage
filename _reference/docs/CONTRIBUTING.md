# Contributing to YAGE

Thank you for considering contributing to YAGE! This guide will help you understand how to work with the codebase effectively.

## Development Setup

### Prerequisites

- Node.js (v18 or higher recommended)
- npm (v9 or higher)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd yage

# Install dependencies
npm install
```

## Development Workflow

### Running the Development Server

```bash
npm run dev
```

This starts Vite's development server. You can then open any example in your browser.

### Building the Library

```bash
# Build all targets (ESM, CJS, and types)
npm run build

# Build in watch mode
npm run build:watch

# Build specific targets
npm run build-esm
npm run build-cjs
npm run build-types
```

### Running Tests

```bash
# Run all tests
npm test
```

### Linting

```bash
# Lint the codebase
npm run lint

# Auto-fix linting issues
npm run lint -- --fix
```

### Generating Documentation

```bash
npm run docs
```

This generates TypeDoc documentation in the `docs/` directory.

## Project Structure

```
yage/
├── src/                   # Source code
│   ├── Game/             # Game instance
│   ├── Scene/            # Scene management
│   ├── GameObject/       # GameObject base
│   ├── components/       # Component library
│   ├── Process/          # Process system
│   ├── Executor/         # Context management
│   ├── premade/          # Premade assets
│   ├── utils/            # Utilities
│   └── index.ts          # Main export
├── examples/             # Example projects
├── dist/                 # Build output (generated)
└── docs/                 # Generated documentation
```

## Coding Guidelines

### TypeScript

- Use TypeScript for all new code
- Prefer strong typing over `any`
- Use generics for reusable components
- Document public APIs with JSDoc comments
- Enable strict type checking

### Code Style

This project uses ESLint and Prettier for code formatting:

- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Max line length: 80 characters (where reasonable)
- Use camelCase for variables and functions
- Use PascalCase for classes and types

### Naming Conventions

- **Classes**: PascalCase (e.g., `GameObject`, `GraphicComponent`)
- **Files**: Match class name (e.g., `GameObject/index.ts`)
- **Variables/Functions**: camelCase (e.g., `onTick`, `rigidBody`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DEFAULT_OPTIONS`)
- **Private members**: prefix with underscore (e.g., `_scene`)
- **Type parameters**: Single letter or descriptive (e.g., `T`, `ParentScene`)

### File Organization

- One class per file (in most cases)
- Index files (`index.ts`) for barrel exports
- Co-locate tests with source files
- Use subdirectories for related functionality

### Comments

- Use JSDoc for public APIs
- Explain "why" not "what" in comments
- Keep comments concise and up-to-date
- Remove commented-out code

Example:
```typescript
/**
 * Transitions from the current scene to a new scene with animation.
 *
 * @param scene - The scene to transition to
 * @param duration - Transition duration in milliseconds
 * @param transitionFunction - Custom transition animation function
 */
async transitionTo(scene: GameScene, duration = 750) {
  // Implementation
}
```

## Component Development

### Creating a New Component

1. Create a new directory in `src/components/`
2. Create `index.ts` with your component class
3. Extend `Component` base class
4. Implement lifecycle hooks as needed
5. Export from `src/components/index.ts`

Example:
```typescript
import { Component } from '../BaseComponent'
import { GameObject } from '../../GameObject'

export class MyComponent extends Component<GameObject> {
  name = 'my-component'

  constructor(parent: GameObject) {
    super(parent)
    // Initialization logic
  }

  onAdded() {
    // Called when added to GameObject
  }

  onTick(dt: number) {
    // Update logic
  }

  onRemoved() {
    // Called when removed from GameObject
  }

  destroy() {
    // Cleanup logic
    super.destroy()
  }
}
```

### Component Guidelines

- Keep components focused on a single responsibility
- Use composition over inheritance
- Minimize dependencies between components
- Make components reusable and configurable
- Document component options and behavior

## GameObject Development

### Creating a New GameObject

1. Create a class extending `GameObject`
2. Add necessary components in constructor
3. Configure component options
4. Export and document

Example:
```typescript
import { GameObject } from 'yage'
import { GraphicComponent, RapierBodyComponent } from 'yage'

export class Player extends GameObject {
  constructor(scene: Scene) {
    super(scene)

    this.name = 'player'
    this.tags = ['player', 'controllable']

    // Add components
    this.addComponent(GraphicComponent, { ... })
    this.addComponent(RapierBodyComponent, ...)
  }

  onAdded() {
    // Setup after being added to scene
  }
}
```

## Scene Development

### Creating a New Scene

1. Extend `Scene` class
2. Define state type (if needed)
3. Configure asset bundle
4. Implement `onLoad()` and other lifecycle hooks

Example:
```typescript
import { Scene } from 'yage'

interface MySceneState {
  score: number
  lives: number
}

export class MyScene extends Scene<MySceneState> {
  assetsBundle = {
    'background': 'assets/bg.png',
  }

  constructor() {
    super({ score: 0, lives: 3 })
  }

  onLoad() {
    super.onLoad()
    // Initialize scene
  }

  onTick(dt: number) {
    super.onTick(dt)
    // Custom logic
  }
}
```

## Testing Guidelines

### Unit Tests

- Test public APIs
- Test edge cases and error conditions
- Use descriptive test names
- Keep tests isolated and independent
- Mock external dependencies

Example:
```typescript
import { describe, it, expect } from 'vitest'
import { MyComponent } from './index'

describe('MyComponent', () => {
  it('should initialize with default values', () => {
    const component = new MyComponent(mockGameObject)
    expect(component.name).toBe('my-component')
  })

  it('should handle edge case X', () => {
    // Test implementation
  })
})
```

## Adding Examples

Examples help demonstrate features and serve as documentation:

1. Create a new directory in `examples/`
2. Add `index.html`, `main.ts`, `style.css`
3. Create a scene demonstrating the feature
4. Keep examples simple and focused
5. Comment code to explain key concepts

## Performance Considerations

### General Guidelines

- Avoid querying GameObjects/Components in hot loops
- Use object pooling for frequently created objects
- Minimize allocations in tick methods
- Use fixed timestep for physics
- Profile before optimizing

### Common Pitfalls

- Creating objects in `onTick()` or `onFixedTick()`
- Querying by class/name/tag repeatedly
- Large asset bundles without loading screens
- Not cleaning up event listeners
- Memory leaks from process references

## Pull Request Process

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/my-feature
   ```
3. **Make your changes**
   - Follow coding guidelines
   - Add tests
   - Update documentation
4. **Test your changes**
   ```bash
   npm test
   npm run lint
   npm run build
   ```
5. **Commit your changes**
   ```bash
   git commit -m "feat: add new feature"
   ```
   Use conventional commit messages:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation
   - `style:` Formatting
   - `refactor:` Code restructuring
   - `test:` Adding tests
   - `chore:` Maintenance
6. **Push to your fork**
   ```bash
   git push origin feature/my-feature
   ```
7. **Open a Pull Request**
   - Describe your changes
   - Reference any related issues
   - Include screenshots/examples if applicable

## Common Tasks

### Adding a New Utility Function

1. Add to appropriate file in `src/utils/`
2. Export from `src/utils/index.ts`
3. Add JSDoc documentation
4. Add unit tests

### Adding a New Premade GameObject

1. Create in `src/premade/gameobjects/`
2. Export from `src/premade/gameobjects/index.ts`
3. Add example demonstrating usage
4. Document in README

### Updating Dependencies

```bash
# Check for outdated packages
npm outdated

# Update a specific package
npm update package-name

# Update all packages (careful!)
npm update

# Test after updating
npm test
npm run build
```

## Documentation

### Code Documentation

- Use JSDoc for all public APIs
- Include parameter descriptions
- Include return value descriptions
- Add usage examples for complex APIs
- Document edge cases and gotchas

### README and Guides

- Keep README concise and up-to-date
- Update ARCHITECTURE.md for architectural changes
- Add examples for new features
- Update changelog

## Getting Help

- Check existing documentation
- Look at examples
- Search for similar issues
- Ask questions in discussions
- Be specific and provide context

## Code Review

### As a Reviewer

- Be constructive and respectful
- Test the changes locally
- Check for edge cases
- Verify documentation is updated
- Ensure tests pass

### As an Author

- Respond to feedback promptly
- Be open to suggestions
- Explain your reasoning
- Update based on feedback
- Keep PRs focused and small

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Run full test suite
4. Build all targets
5. Create git tag
6. Push to repository
7. Publish to npm (if applicable)

## Best Practices

### Component Design

- Single responsibility
- Configurable via constructor
- Minimal coupling
- Clear lifecycle
- Proper cleanup

### Performance

- Profile before optimizing
- Use object pools
- Minimize allocations
- Cache queries when appropriate
- Use appropriate data structures

### Architecture

- Keep systems decoupled
- Use events for loose coupling
- Favor composition over inheritance
- Keep public APIs minimal
- Design for extensibility

### Error Handling

- Validate inputs
- Throw meaningful errors
- Clean up on errors
- Document error conditions
- Use TypeScript for type safety

## Troubleshooting

### Build Errors

- Clear `dist/` and rebuild
- Clear `node_modules/` and reinstall
- Check TypeScript version
- Verify all imports are correct

### Test Failures

- Run tests individually to isolate
- Check for async issues
- Verify mocks are correct
- Look for test interdependencies

### Runtime Errors

- Check browser console
- Verify assets are loaded
- Check for race conditions
- Verify component initialization order

## Resources

- [PixiJS Documentation](https://pixijs.com/docs)
- [Rapier2D Documentation](https://rapier.rs/docs/)
- [XState Documentation](https://xstate.js.org/docs/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Vite Documentation](https://vitejs.dev/guide/)

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
