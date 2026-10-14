import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DialogProvider, Modal } from '../src/ui/Modal';

function renderModal(props: { dirty?: boolean; onClose?(): void } = {}) {
  const onClose = props.onClose ?? vi.fn();
  render(
    <DialogProvider>
      <Modal title="Edit lead" dirty={props.dirty} onClose={onClose}><input aria-label="Name" /></Modal>
    </DialogProvider>,
  );
  return onClose;
}

describe('Modal', () => {
  it('is a labelled dialog and closes with Escape', async () => {
    const onClose = renderModal();
    expect(screen.getByRole('dialog', { name: 'Edit lead' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('closes from the close button', async () => {
    const onClose = renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('asks before throwing away unsaved changes, and keeps editing on "Keep editing"', async () => {
    const onClose = renderModal({ dirty: true });
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('You have unsaved changes in this form.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
