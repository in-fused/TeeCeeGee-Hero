import { useState, useCallback } from 'react';
import { useWebhooks, useWebhookHealth, useEventTypes } from '@/hooks/useWebhooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { 
  Webhook, 
  Plus, 
  RefreshCw, 
  CheckCircle2, 
  XCircle,
  Clock,
  AlertTriangle,
  Trash2,
  Edit,
  Copy,
} from 'lucide-react';
import type { WebhookSubscription, WebhookEventType } from '@/types';

export function WebhookManager() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookSubscription | null>(null);
  const [newWebhook, setNewWebhook] = useState<Partial<WebhookSubscription>>({
    events: [],
    isActive: true,
  });

  const { 
    subscriptions, 
    loading, 
    error: _error, 
    refresh, 
    createSubscription, 
    updateSubscription,
    deleteSubscription 
  } = useWebhooks();

  const { health } = useWebhookHealth();
  const { categories, getByCategory } = useEventTypes();

  const handleCreateWebhook = useCallback(async () => {
    if (!newWebhook.url || !newWebhook.events || newWebhook.events.length === 0) {
      toast.error('Please enter URL and select at least one event');
      return;
    }

    try {
      const secret = `whsec_${Math.random().toString(36).substring(2, 15)}`;
      await createSubscription(
        newWebhook.url,
        newWebhook.events as WebhookEventType[],
        secret
      );
      toast.success('Webhook created successfully');
      setCreateDialogOpen(false);
      setNewWebhook({ events: [], isActive: true });
    } catch (err) {
      toast.error('Failed to create webhook');
    }
  }, [newWebhook, createSubscription]);

  const handleUpdateWebhook = useCallback(async () => {
    if (!editingWebhook) return;

    try {
      await updateSubscription(editingWebhook.id, {
        url: editingWebhook.url,
        events: editingWebhook.events,
        isActive: editingWebhook.isActive,
      });
      toast.success('Webhook updated successfully');
      setEditingWebhook(null);
    } catch (err) {
      toast.error('Failed to update webhook');
    }
  }, [editingWebhook, updateSubscription]);

  const handleDeleteWebhook = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook?')) return;

    try {
      await deleteSubscription(id);
      toast.success('Webhook deleted');
    } catch (err) {
      toast.error('Failed to delete webhook');
    }
  }, [deleteSubscription]);

  const toggleEvent = useCallback((eventType: WebhookEventType, isEditing: boolean = false) => {
    if (isEditing && editingWebhook) {
      const events = editingWebhook.events.includes(eventType)
        ? editingWebhook.events.filter(e => e !== eventType)
        : [...editingWebhook.events, eventType];
      setEditingWebhook({ ...editingWebhook, events });
    } else {
      const events = newWebhook.events?.includes(eventType)
        ? newWebhook.events.filter(e => e !== eventType)
        : [...(newWebhook.events || []), eventType];
      setNewWebhook(prev => ({ ...prev, events }));
    }
  }, [newWebhook.events, editingWebhook]);

  const copySecret = useCallback((secret: string) => {
    navigator.clipboard.writeText(secret);
    toast.success('Secret copied to clipboard');
  }, []);

  return (
    <div className="space-y-6">
      {/* Health Status */}
      {health && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Webhooks</CardTitle>
              <Webhook className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{health.activeSubscriptions}</div>
              <p className="text-xs text-muted-foreground">
                of {health.totalSubscriptions} total
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Queued Events</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{health.queuedEvents}</div>
              <p className="text-xs text-muted-foreground">Waiting to be delivered</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {health.totalDeliveries > 0
                  ? Math.round((health.successfulDeliveries / health.totalDeliveries) * 100)
                  : 0}%
              </div>
              <p className="text-xs text-muted-foreground">
                {health.successfulDeliveries} successful deliveries
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Failed Deliveries</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{health.failedDeliveries}</div>
              <p className="text-xs text-muted-foreground">Require attention</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Actions Bar */}
      <div className="flex items-center gap-2">
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Webhook
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Webhook</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Endpoint URL</label>
                <Input
                  value={newWebhook.url || ''}
                  onChange={(e) => setNewWebhook(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://your-app.com/webhook"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Events to Subscribe</label>
                <div className="mt-2 space-y-4">
                  {categories.map((category) => (
                    <div key={category}>
                      <h4 className="text-sm font-semibold capitalize mb-2">{category}</h4>
                      <div className="space-y-2">
                        {getByCategory(category).map((event) => (
                          <div key={event.type} className="flex items-start space-x-2">
                            <Checkbox
                              id={event.type}
                              checked={newWebhook.events?.includes(event.type)}
                              onCheckedChange={() => toggleEvent(event.type)}
                            />
                            <div className="grid gap-1.5 leading-none">
                              <label
                                htmlFor={event.type}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                              >
                                {event.type}
                              </label>
                              <p className="text-xs text-muted-foreground">
                                {event.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Button onClick={handleCreateWebhook} className="w-full">
                Create Webhook
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Button variant="outline" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Webhooks Table */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Triggered</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : subscriptions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No webhooks configured
                    </TableCell>
                  </TableRow>
                ) : (
                  subscriptions.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        <div className="max-w-xs truncate" title={subscription.url}>
                          {subscription.url}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {subscription.events.slice(0, 3).map((event) => (
                            <Badge key={event} variant="outline" className="text-xs">
                              {event.split('.')[0]}
                            </Badge>
                          ))}
                          {subscription.events.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{subscription.events.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {subscription.isActive ? (
                          <Badge className="bg-green-500">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="h-3 w-3 mr-1" />
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {new Date(subscription.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {subscription.lastTriggeredAt
                          ? new Date(subscription.lastTriggeredAt).toLocaleString()
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Dialog open={editingWebhook?.id === subscription.id} onOpenChange={(open) => {
                            if (!open) setEditingWebhook(null);
                            else setEditingWebhook(subscription);
                          }}>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Edit Webhook</DialogTitle>
                              </DialogHeader>
                              {editingWebhook && (
                                <div className="space-y-4">
                                  <div>
                                    <label className="text-sm font-medium">Endpoint URL</label>
                                    <Input
                                      value={editingWebhook.url}
                                      onChange={(e) => setEditingWebhook(prev => 
                                        prev ? { ...prev, url: e.target.value } : null
                                      )}
                                    />
                                  </div>

                                  <div>
                                    <label className="text-sm font-medium">Secret</label>
                                    <div className="flex gap-2">
                                      <Input
                                        value={editingWebhook.secret}
                                        readOnly
                                        type="password"
                                      />
                                      <Button 
                                        variant="outline" 
                                        size="icon"
                                        onClick={() => copySecret(editingWebhook.secret)}
                                      >
                                        <Copy className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>

                                  <div>
                                    <label className="text-sm font-medium">Events</label>
                                    <div className="mt-2 space-y-4">
                                      {categories.map((category) => (
                                        <div key={category}>
                                          <h4 className="text-sm font-semibold capitalize mb-2">
                                            {category}
                                          </h4>
                                          <div className="space-y-2">
                                            {getByCategory(category).map((event) => (
                                              <div key={event.type} className="flex items-start space-x-2">
                                                <Checkbox
                                                  id={`edit-${event.type}`}
                                                  checked={editingWebhook.events.includes(event.type)}
                                                  onCheckedChange={() => toggleEvent(event.type, true)}
                                                />
                                                <div className="grid gap-1.5 leading-none">
                                                  <label
                                                    htmlFor={`edit-${event.type}`}
                                                    className="text-sm font-medium"
                                                  >
                                                    {event.type}
                                                  </label>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id="isActive"
                                      checked={editingWebhook.isActive}
                                      onCheckedChange={(checked) => 
                                        setEditingWebhook(prev => 
                                          prev ? { ...prev, isActive: checked as boolean } : null
                                        )
                                      }
                                    />
                                    <label htmlFor="isActive" className="text-sm font-medium">
                                      Active
                                    </label>
                                  </div>

                                  <Button onClick={handleUpdateWebhook} className="w-full">
                                    Save Changes
                                  </Button>
                                </div>
                              )}
                            </DialogContent>
                          </Dialog>

                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => handleDeleteWebhook(subscription.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Event Types Reference */}
      <Card>
        <CardHeader>
          <CardTitle>Event Types Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {categories.map((category) => (
              <div key={category}>
                <h4 className="font-semibold capitalize mb-2">{category} Events</h4>
                <ul className="space-y-1">
                  {getByCategory(category).map((event) => (
                    <li key={event.type} className="text-sm">
                      <code className="bg-muted px-1 py-0.5 rounded text-xs">
                        {event.type}
                      </code>
                      <span className="text-muted-foreground ml-2">
                        {event.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
