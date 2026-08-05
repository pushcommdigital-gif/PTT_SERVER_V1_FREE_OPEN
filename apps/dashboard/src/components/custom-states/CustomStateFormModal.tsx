/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { apiFetch } from '../../lib/api';
import type { CustomStateData } from '../../hooks/useCustomStates';

interface CustomStateFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editState?: CustomStateData | null;
  defaultType?: string;
}

const TYPE_OPTIONS = [
  { value: 'personnel', label: 'Personnel' },
  { value: 'staffing', label: 'Staffing' },
  { value: 'unit', label: 'Unit' },
];

const PRESET_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#27ae60',
  '#3498db', '#9b59b6', '#1abc9c', '#95a5a6',
];

export function CustomStateFormModal({ open, onClose, onSuccess, editState, defaultType }: CustomStateFormModalProps) {
  const [type, setType] = useState(defaultType || 'personnel');
  const [name, setName] = useState('');
  const [buttonText, setButtonText] = useState('');
  const [buttonColor, setButtonColor] = useState('#3498db');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editState) {
      setType(editState.type);
      setName(editState.name);
      setButtonText(editState.buttonText);
      setButtonColor(editState.buttonColor);
    } else {
      setType(defaultType || 'personnel');
      setName('');
      setButtonText('');
      setButtonColor('#3498db');
    }
    setError('');
  }, [editState, defaultType, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (editState) {
        await apiFetch(`/custom-states/${editState.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, buttonText, buttonColor }),
        });
      } else {
        await apiFetch('/custom-states', {
          method: 'POST',
          body: JSON.stringify({ type, name, buttonText, buttonColor }),
        });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editState ? 'Edit Custom State' : 'Create Custom State'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {!editState && (
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={TYPE_OPTIONS}
          />
        )}

        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Available, Responding..."
          required
        />

        <Input
          label="Button Text"
          value={buttonText}
          onChange={(e) => setButtonText(e.target.value)}
          placeholder="Short label for button"
          required
        />

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Button Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={buttonColor}
              onChange={(e) => setButtonColor(e.target.value)}
              className="w-10 h-10 rounded cursor-pointer border border-border bg-transparent"
            />
            <div className="flex gap-1.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setButtonColor(color)}
                  className={`w-7 h-7 rounded-md transition-all ${
                    buttonColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-bg-primary' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="pt-2">
          <label className="block text-sm font-medium text-text-secondary mb-2">Preview</label>
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: buttonColor }}
          >
            {buttonText || 'Button Preview'}
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>
            {editState ? 'Save Changes' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
